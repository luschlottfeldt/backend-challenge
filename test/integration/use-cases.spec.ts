import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { MikroORM } from '@mikro-orm/postgresql';
import { createTestOrm, truncateAll } from './orm-fixture.js';
import { MutableClock, wireUseCases } from './wire-use-cases.js';
import { OutboxMessageOrmEntity } from '../../src/infrastructure/database/entities/outbox-message.entity.js';
import { WagerTransactionKind } from '../../src/domain/enums/wager-transaction-kind.enum.js';
import { LedgerDirection } from '../../src/domain/enums/ledger-direction.enum.js';
import { WagerTransactionStatus } from '../../src/domain/enums/wager-transaction-status.enum.js';
import { FailureCode } from '../../src/domain/enums/failure-code.js';
import { WalletAlreadyExistsError } from '../../src/domain/errors/wallet-already-exists.error.js';
import { WalletNotFoundError } from '../../src/domain/errors/wallet-not-found.error.js';
import { IdempotencyConflictError } from '../../src/domain/errors/idempotency-conflict.error.js';
import { WagerTransactionNotFoundError } from '../../src/domain/errors/wager-transaction-not-found.error.js';

let orm: MikroORM;
let clock: MutableClock;
let uc: ReturnType<typeof wireUseCases>;
const BASE = new Date('2026-09-01T00:00:00.000Z');
const brl = (amount: string) => ({ amount, currency: 'BRL' });

beforeAll(async () => {
  orm = await createTestOrm();
});
afterAll(async () => {
  await orm.close();
});
beforeEach(async () => {
  await truncateAll(orm);
  clock = new MutableClock(new Date(BASE));
  uc = wireUseCases(orm, clock);
});

const openWallet = (amount = '100.00') =>
  uc.createWallet.execute({ playerId: crypto.randomUUID(), initialBalance: brl(amount) });

const submitBet = (walletId: string, playerId: string, over: Record<string, unknown> = {}) => {
  const externalTransactionId = crypto.randomUUID();
  return uc.submit.execute({
    idempotencyKey: `provider-a:${externalTransactionId}`,
    providerId: 'provider-a',
    externalTransactionId,
    playerId,
    walletId,
    roundId: 'round-1',
    gameId: 'game-1',
    kind: WagerTransactionKind.Bet,
    money: brl('25.00'),
    ...over,
  });
};

const outboxTypes = async (): Promise<string[]> => {
  const rows = await orm.em.fork().find(OutboxMessageOrmEntity, {}, { orderBy: { occurredAt: 'asc' } });
  return rows.map((r) => r.eventType);
};

describe('CreateWalletUseCase', () => {
  it('opens a wallet at version 1 with an opening ledger entry and events', async () => {
    const wallet = await openWallet('1000.00');
    expect(wallet.version).toBe(1);
    expect(wallet.balance).toEqual(brl('1000.00'));

    const page = await uc.getLedger.execute({ walletId: wallet.id });
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]!.direction).toBe(LedgerDirection.Credit);
    expect(await outboxTypes()).toEqual(['WalletBalanceChanged', 'WagerTransactionProcessed']);
  });

  it('opens a zero-balance wallet with no ledger entry and no events', async () => {
    const wallet = await openWallet('0.00');
    const page = await uc.getLedger.execute({ walletId: wallet.id });
    expect(page.entries).toHaveLength(0);
    expect(await outboxTypes()).toEqual([]);
  });

  it('rejects a duplicate wallet for the same player + currency', async () => {
    const playerId = crypto.randomUUID();
    await uc.createWallet.execute({ playerId, initialBalance: brl('10.00') });
    await expect(uc.createWallet.execute({ playerId, initialBalance: brl('10.00') })).rejects.toThrow(
      WalletAlreadyExistsError,
    );
  });
});

describe('SubmitWagerTransactionUseCase - core', () => {
  it('processes a BET, debiting the wallet and writing one ledger entry + events', async () => {
    const wallet = await openWallet('100.00');
    const result = await submitBet(wallet.id, wallet.playerId);

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance).toEqual(brl('75.00'));
    expect(result.idempotentReplay).toBe(false);

    expect((await uc.getWallet.execute(wallet.id)).balance).toEqual(brl('75.00'));
    const page = await uc.getLedger.execute({ walletId: wallet.id });
    expect(page.entries.filter((e) => e.direction === LedgerDirection.Debit)).toHaveLength(1);
    expect(await outboxTypes()).toContain('WalletBalanceChanged');
    expect(await outboxTypes()).toContain('WagerTransactionProcessed');
  });

  it('rejects a BET with insufficient funds and leaves the balance untouched', async () => {
    const wallet = await openWallet('20.00');
    const result = await submitBet(wallet.id, wallet.playerId, { money: brl('25.00') });

    expect(result.status).toBe(WagerTransactionStatus.Rejected);
    expect(result.failureCode).toBe(FailureCode.InsufficientFunds);
    expect(result.balance).toEqual(brl('20.00'));

    const page = await uc.getLedger.execute({ walletId: wallet.id });
    expect(page.entries.filter((e) => e.direction === LedgerDirection.Debit)).toHaveLength(0);
    expect(await outboxTypes()).toContain('WagerTransactionRejected');
  });

  it('credits a WIN and records a LOSS without moving the balance', async () => {
    const wallet = await openWallet('100.00');
    const win = await submitBet(wallet.id, wallet.playerId, {
      kind: WagerTransactionKind.Win,
      money: brl('30.00'),
    });
    expect(win.balance).toEqual(brl('130.00'));

    const loss = await submitBet(wallet.id, wallet.playerId, {
      kind: WagerTransactionKind.Loss,
      money: brl('10.00'),
    });
    expect(loss.status).toBe(WagerTransactionStatus.Processed);
    expect(loss.balance).toEqual(brl('130.00'));

    const types = await outboxTypes();
    expect(types.filter((t) => t === 'WalletBalanceChanged')).toHaveLength(2); // opening + win only
  });

  it('rejects an operation whose currency differs from the wallet', async () => {
    const wallet = await openWallet('100.00');
    const result = await submitBet(wallet.id, wallet.playerId, { money: { amount: '10.00', currency: 'USD' } });
    expect(result.status).toBe(WagerTransactionStatus.Rejected);
    expect(result.failureCode).toBe(FailureCode.CurrencyMismatch);
  });

  it('throws when the wallet does not exist', async () => {
    await expect(submitBet(crypto.randomUUID(), crypto.randomUUID())).rejects.toThrow(WalletNotFoundError);
  });
});

describe('SubmitWagerTransactionUseCase - idempotency', () => {
  it('replays an identical request with the balance observed at processing time', async () => {
    const wallet = await openWallet('100.00');
    const externalTransactionId = crypto.randomUUID();
    const command = {
      idempotencyKey: `provider-a:${externalTransactionId}`,
      providerId: 'provider-a',
      externalTransactionId,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'r',
      gameId: 'g',
      kind: WagerTransactionKind.Bet,
      money: brl('25.00'),
    };

    const first = await uc.submit.execute(command);
    // move the balance with an unrelated bet
    await submitBet(wallet.id, wallet.playerId, { money: brl('10.00') });
    const replay = await uc.submit.execute(command);

    expect(replay.idempotentReplay).toBe(true);
    expect(replay.transactionId).toBe(first.transactionId);
    expect(replay.balance).toEqual(brl('75.00'));
    expect((await uc.getWallet.execute(wallet.id)).balance).toEqual(brl('65.00'));
  });

  it('replays a LOSS with the balance observed when it was processed, not the current one', async () => {
    const wallet = await openWallet('100.00');
    const externalTransactionId = crypto.randomUUID();
    const command = {
      idempotencyKey: `provider-a:${externalTransactionId}`,
      providerId: 'provider-a',
      externalTransactionId,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'r',
      gameId: 'g',
      kind: WagerTransactionKind.Loss,
      money: brl('10.00'),
    };

    const first = await uc.submit.execute(command);
    expect(first.balance).toEqual(brl('100.00'));

    await submitBet(wallet.id, wallet.playerId, { money: brl('30.00') });

    const replay = await uc.submit.execute(command);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.status).toBe(WagerTransactionStatus.Processed);
    expect(replay.balance).toEqual(brl('100.00'));
    expect((await uc.getWallet.execute(wallet.id)).balance).toEqual(brl('70.00'));
  });

  it('replays a rejected BET with the balance observed at rejection time', async () => {
    const wallet = await openWallet('20.00');
    const externalTransactionId = crypto.randomUUID();
    const command = {
      idempotencyKey: `provider-a:${externalTransactionId}`,
      providerId: 'provider-a',
      externalTransactionId,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'r',
      gameId: 'g',
      kind: WagerTransactionKind.Bet,
      money: brl('25.00'),
    };

    const first = await uc.submit.execute(command);
    expect(first.status).toBe(WagerTransactionStatus.Rejected);
    expect(first.balance).toEqual(brl('20.00'));

    await uc.submit.execute({
      ...command,
      idempotencyKey: `provider-a:${crypto.randomUUID()}`,
      externalTransactionId: crypto.randomUUID(),
      kind: WagerTransactionKind.Win,
      money: brl('50.00'),
    });

    const replay = await uc.submit.execute(command);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.status).toBe(WagerTransactionStatus.Rejected);
    expect(replay.failureCode).toBe(FailureCode.InsufficientFunds);
    expect(replay.balance).toEqual(brl('20.00'));
    expect((await uc.getWallet.execute(wallet.id)).balance).toEqual(brl('70.00'));
  });

  it('rejects the same key with a different payload as a conflict', async () => {
    const wallet = await openWallet('100.00');
    const externalTransactionId = crypto.randomUUID();
    const base = {
      idempotencyKey: `provider-a:${externalTransactionId}`,
      providerId: 'provider-a',
      externalTransactionId,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'r',
      gameId: 'g',
      kind: WagerTransactionKind.Bet,
    };
    await uc.submit.execute({ ...base, money: brl('25.00') });
    await expect(uc.submit.execute({ ...base, money: brl('26.00') })).rejects.toThrow(
      IdempotencyConflictError,
    );
  });
});

describe('SubmitWagerTransactionUseCase - references', () => {
  const submitRef = (
    walletId: string,
    playerId: string,
    kind: WagerTransactionKind,
    referenceExternalTransactionId: string,
    money = brl('25.00'),
  ) => {
    const externalTransactionId = crypto.randomUUID();
    return uc.submit.execute({
      idempotencyKey: `provider-a:${externalTransactionId}`,
      providerId: 'provider-a',
      externalTransactionId,
      playerId,
      walletId,
      roundId: 'round-1',
      gameId: 'game-1',
      kind,
      money,
      referenceExternalTransactionId,
    });
  };

  it('holds a REFUND as PENDING_REFERENCE, then processes it once the BET arrives', async () => {
    const wallet = await openWallet('100.00');
    const betExternalId = 'bet-ext-1';

    const refund = await submitRef(wallet.id, wallet.playerId, WagerTransactionKind.Refund, betExternalId);
    expect(refund.status).toBe(WagerTransactionStatus.PendingReference);
    expect(await outboxTypes()).toContain('WagerTransactionPendingReference');

    await uc.submit.execute({
      idempotencyKey: `provider-a:${betExternalId}`,
      providerId: 'provider-a',
      externalTransactionId: betExternalId,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      money: brl('25.00'),
    });

    clock.advance(10_000);
    const report = await uc.reprocess.execute();
    expect(report.processed).toBe(1);

    expect((await uc.getWallet.execute(wallet.id)).balance).toEqual(brl('100.00'));
    expect((await uc.getTransaction.byId(refund.transactionId)).status).toBe(
      WagerTransactionStatus.Processed,
    );
  });

  it('rejects a REFUND that references a WIN (kind not allowed)', async () => {
    const wallet = await openWallet('100.00');
    const winExternalId = 'win-ext-1';
    await uc.submit.execute({
      idempotencyKey: `provider-a:${winExternalId}`,
      providerId: 'provider-a',
      externalTransactionId: winExternalId,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Win,
      money: brl('25.00'),
    });
    const refund = await submitRef(wallet.id, wallet.playerId, WagerTransactionKind.Refund, winExternalId);
    expect(refund.failureCode).toBe(FailureCode.ReferenceKindNotAllowed);
  });

  it('rejects a REFUND whose amount differs from the BET', async () => {
    const wallet = await openWallet('100.00');
    const betExternalId = 'bet-ext-2';
    await uc.submit.execute({
      idempotencyKey: `provider-a:${betExternalId}`,
      providerId: 'provider-a',
      externalTransactionId: betExternalId,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      money: brl('25.00'),
    });
    const refund = await submitRef(
      wallet.id,
      wallet.playerId,
      WagerTransactionKind.Refund,
      betExternalId,
      brl('20.00'),
    );
    expect(refund.failureCode).toBe(FailureCode.AmountMismatch);
  });

  it('rejects a second REFUND of the same BET as already reversed', async () => {
    const wallet = await openWallet('100.00');
    const betExternalId = 'bet-ext-3';
    await uc.submit.execute({
      idempotencyKey: `provider-a:${betExternalId}`,
      providerId: 'provider-a',
      externalTransactionId: betExternalId,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      money: brl('25.00'),
    });
    const first = await submitRef(wallet.id, wallet.playerId, WagerTransactionKind.Refund, betExternalId);
    expect(first.status).toBe(WagerTransactionStatus.Processed);
    const second = await submitRef(wallet.id, wallet.playerId, WagerTransactionKind.Refund, betExternalId);
    expect(second.failureCode).toBe(FailureCode.ReferenceAlreadyReversed);
  });

  it('rolls a BET back, crediting the wallet', async () => {
    const wallet = await openWallet('100.00');
    const betExternalId = 'bet-ext-4';
    const bet = await uc.submit.execute({
      idempotencyKey: `provider-a:${betExternalId}`,
      providerId: 'provider-a',
      externalTransactionId: betExternalId,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      money: brl('25.00'),
    });
    expect(bet.balance).toEqual(brl('75.00'));

    const rollback = await submitRef(
      wallet.id,
      wallet.playerId,
      WagerTransactionKind.Rollback,
      betExternalId,
    );
    expect(rollback.status).toBe(WagerTransactionStatus.Processed);
    expect(rollback.balance).toEqual(brl('100.00'));
  });

  it('rejects a PENDING_REFERENCE after the retry budget is exhausted', async () => {
    const wallet = await openWallet('100.00');
    const refund = await submitRef(wallet.id, wallet.playerId, WagerTransactionKind.Refund, 'never-arrives');
    expect(refund.status).toBe(WagerTransactionStatus.PendingReference);

    for (let i = 0; i < 10; i += 1) {
      clock.advance(3_700_000);
      await uc.reprocess.execute();
    }

    const final = await uc.getTransaction.byId(refund.transactionId);
    expect(final.status).toBe(WagerTransactionStatus.Rejected);
    expect(final.failureCode).toBe(FailureCode.ReferenceNotFound);
  });
});

describe('query use cases', () => {
  it('paginates the ledger with a stable cursor', async () => {
    const wallet = await openWallet('1000.00');
    for (let i = 0; i < 4; i += 1) {
      clock.advance(1000);
      await submitBet(wallet.id, wallet.playerId, { money: brl('10.00') });
    }

    const page1 = await uc.getLedger.execute({ walletId: wallet.id, limit: 3 });
    expect(page1.entries).toHaveLength(3);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await uc.getLedger.execute({ walletId: wallet.id, cursor: page1.nextCursor!, limit: 3 });
    expect(page2.entries).toHaveLength(2); // 5 entries total: opening + 4 bets
    expect(page2.nextCursor).toBeNull();
  });

  it('looks a transaction up by id and by provider + external id', async () => {
    const wallet = await openWallet('100.00');
    const result = await submitBet(wallet.id, wallet.playerId);
    const byId = await uc.getTransaction.byId(result.transactionId);
    const byExternal = await uc.getTransaction.byProviderAndExternalId(
      byId.providerId,
      byId.externalTransactionId,
    );
    expect(byExternal.id).toBe(result.transactionId);
    await expect(uc.getTransaction.byId(crypto.randomUUID())).rejects.toThrow(
      WagerTransactionNotFoundError,
    );
  });
});

describe('ReconcileWalletUseCase', () => {
  it('reports a consistent wallet and counts the entries', async () => {
    const wallet = await openWallet('100.00');
    await submitBet(wallet.id, wallet.playerId, { money: brl('40.00') });

    const report = await uc.reconcile.execute(wallet.id);
    expect(report.consistent).toBe(true);
    expect(report.difference).toEqual(brl('0.00'));
    expect(report.checkedEntries).toBe(2);
    expect(report.storedBalance).toEqual(brl('60.00'));
  });

  it('flags a divergence when the materialized balance is corrupted', async () => {
    const wallet = await openWallet('100.00');
    await orm.em
      .getConnection()
      .execute(`update wallets set balance_amount = '999.00' where id = ?`, [wallet.id]);
    orm.em.clear();

    const report = await uc.reconcile.execute(wallet.id);
    expect(report.consistent).toBe(false);
    expect(report.calculatedBalance).toEqual(brl('100.00'));
    expect(report.storedBalance).toEqual(brl('999.00'));
    expect(report.difference).toEqual(brl('899.00'));
  });

  it('throws for an unknown wallet', async () => {
    await expect(uc.reconcile.execute(crypto.randomUUID())).rejects.toThrow(WalletNotFoundError);
  });
});

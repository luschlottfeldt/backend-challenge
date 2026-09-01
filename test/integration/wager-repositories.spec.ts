import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { MikroORM } from '@mikro-orm/postgresql';
import { createTestOrm, truncateAll } from './orm-fixture.js';
import { WalletRepository } from '../../src/infrastructure/database/repositories/wallet.repository.js';
import { WagerTransactionRepository } from '../../src/infrastructure/database/repositories/wager-transaction.repository.js';
import { Wallet } from '../../src/domain/entities/wallet.js';
import { WagerTransaction } from '../../src/domain/entities/wager-transaction.js';
import { Money } from '../../src/domain/entities/money.js';
import { WagerTransactionKind } from '../../src/domain/enums/wager-transaction-kind.enum.js';
import { WagerTransactionStatus } from '../../src/domain/enums/wager-transaction-status.enum.js';
import { FailureCode } from '../../src/domain/enums/failure-code.js';

let orm: MikroORM;
const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });
const NOW = new Date('2026-09-01T00:00:00.000Z');

const uuid = () => crypto.randomUUID();

const makeWallet = (over: Partial<{ id: string; playerId: string; amount: string }> = {}) =>
  Wallet.open({
    id: over.id ?? uuid(),
    playerId: over.playerId ?? uuid(),
    initialBalance: brl(over.amount ?? '100.00'),
    openingTransactionId: uuid(),
    openingLedgerEntryId: uuid(),
    now: NOW,
  }).wallet;

const makeTx = (over: Partial<Parameters<typeof WagerTransaction.create>[0]> = {}) =>
  WagerTransaction.create({
    id: over.id ?? uuid(),
    providerId: over.providerId ?? 'provider-a',
    externalTransactionId: over.externalTransactionId ?? uuid(),
    idempotencyKey: over.idempotencyKey ?? uuid(),
    payloadHash: over.payloadHash ?? 'hash-1',
    walletId: over.walletId ?? uuid(),
    playerId: over.playerId ?? uuid(),
    roundId: over.roundId ?? 'round-1',
    gameId: over.gameId ?? 'game-1',
    kind: over.kind ?? WagerTransactionKind.Bet,
    money: over.money ?? brl('25.00'),
    referenceExternalTransactionId: over.referenceExternalTransactionId,
    createdAt: over.createdAt ?? NOW,
  });

beforeAll(async () => {
  orm = await createTestOrm();
});

afterAll(async () => {
  await orm.close();
});

beforeEach(async () => {
  await truncateAll(orm);
});

describe('WalletRepository', () => {
  it('persists and re-reads a wallet', async () => {
    const em = orm.em.fork();
    const repo = new WalletRepository(em);
    const wallet = makeWallet({ amount: '250.00' });
    await repo.save(wallet);

    const fresh = new WalletRepository(orm.em.fork());
    const loaded = await fresh.findById(wallet.id);
    expect(loaded?.balance.toString()).toBe('250.00');
    expect(loaded?.version).toBe(1);
  });

  it('enforces one wallet per playerId + currency at the schema level', async () => {
    const repo = new WalletRepository(orm.em.fork());
    const playerId = uuid();
    await repo.save(makeWallet({ playerId }));

    const other = new WalletRepository(orm.em.fork());
    await expect(other.save(makeWallet({ playerId }))).rejects.toThrow();
  });

  it('persists balance updates through the assign path', async () => {
    const repo = new WalletRepository(orm.em.fork());
    const wallet = makeWallet({ amount: '100.00' });
    await repo.save(wallet);

    await orm.em.fork().transactional(async (em) => {
      const txRepo = new WalletRepository(em);
      const locked = await txRepo.findByIdForUpdate(wallet.id);
      locked!.debit(brl('30.00'), { transactionId: uuid(), ledgerEntryId: uuid(), occurredAt: NOW });
      await txRepo.save(locked!);
    });

    const loaded = await new WalletRepository(orm.em.fork()).findById(wallet.id);
    expect(loaded?.balance.toString()).toBe('70.00');
    expect(loaded?.version).toBe(2);
  });

  it('findByIdForUpdate returns the row inside a transaction', async () => {
    const repo = new WalletRepository(orm.em.fork());
    const wallet = makeWallet();
    await repo.save(wallet);

    await orm.em.fork().transactional(async (em) => {
      const locked = await new WalletRepository(em).findByIdForUpdate(wallet.id);
      expect(locked?.id).toBe(wallet.id);
    });
  });
});

describe('WagerTransactionRepository', () => {
  it('round-trips a transaction and looks it up by every key', async () => {
    const repo = new WagerTransactionRepository(orm.em.fork());
    const tx = makeTx({ providerId: 'provider-x', externalTransactionId: 'ext-9', idempotencyKey: 'provider-x:ext-9' });
    await repo.save(tx);

    const fresh = new WagerTransactionRepository(orm.em.fork());
    expect((await fresh.findById(tx.id))?.id).toBe(tx.id);
    expect((await fresh.findByIdempotencyKey('provider-x:ext-9'))?.id).toBe(tx.id);
    expect((await fresh.findByProviderAndExternalId('provider-x', 'ext-9'))?.id).toBe(tx.id);
  });

  it('rejects a duplicate idempotency key at the schema level', async () => {
    const repo = new WagerTransactionRepository(orm.em.fork());
    await repo.save(makeTx({ idempotencyKey: 'dup-key' }));
    await expect(
      new WagerTransactionRepository(orm.em.fork()).save(makeTx({ idempotencyKey: 'dup-key' })),
    ).rejects.toThrow();
  });

  it('rejects a duplicate (providerId, externalTransactionId) at the schema level', async () => {
    const repo = new WagerTransactionRepository(orm.em.fork());
    await repo.save(makeTx({ providerId: 'p', externalTransactionId: 'e' }));
    await expect(
      new WagerTransactionRepository(orm.em.fork()).save(makeTx({ providerId: 'p', externalTransactionId: 'e' })),
    ).rejects.toThrow();
  });

  it('persists a terminal transition through the assign path', async () => {
    const repo = new WagerTransactionRepository(orm.em.fork());
    const tx = makeTx();
    await repo.save(tx);

    const reloaded = await new WagerTransactionRepository(orm.em.fork()).findById(tx.id);
    reloaded!.reject(FailureCode.InsufficientFunds);
    await new WagerTransactionRepository(orm.em.fork()).save(reloaded!);

    const final = await new WagerTransactionRepository(orm.em.fork()).findById(tx.id);
    expect(final?.status).toBe(WagerTransactionStatus.Rejected);
    expect(final?.failureCode).toBe(FailureCode.InsufficientFunds);
  });

  it('findPendingReference filters by status and due time', async () => {
    const repo = new WagerTransactionRepository(orm.em.fork());

    const dueNow = makeTx({ kind: WagerTransactionKind.Refund, referenceExternalTransactionId: 'ref-1' });
    dueNow.markPendingReference();
    await repo.save(dueNow);

    const pendingButProcessed = makeTx({ kind: WagerTransactionKind.Bet });
    await repo.save(pendingButProcessed);

    const found = await new WagerTransactionRepository(orm.em.fork()).findPendingReference(
      new Date(NOW.getTime() + 1000),
      10,
    );
    expect(found.map((t) => t.id)).toEqual([dueNow.id]);
  });
});

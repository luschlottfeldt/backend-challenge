import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { RequestContext } from '@mikro-orm/core';
import type { MikroORM } from '@mikro-orm/postgresql';
import { createTestOrm, truncateAll } from '../integration/orm-fixture.js';
import { MutableClock, wireUseCases } from '../integration/wire-use-cases.js';
import { WagerTransactionStatus } from '../../src/domain/enums/wager-transaction-status.enum.js';
import { WagerTransactionKind } from '../../src/domain/enums/wager-transaction-kind.enum.js';
import { FailureCode } from '../../src/domain/enums/failure-code.js';
import { LedgerDirection } from '../../src/domain/enums/ledger-direction.enum.js';

let orm: MikroORM;
let clock: MutableClock;
let uc: ReturnType<typeof wireUseCases>;
const BASE = new Date('2026-09-01T00:00:00.000Z');
const brl = (amount: string) => ({ amount, currency: 'BRL' });

const inContext = <T>(work: () => Promise<T>): Promise<T> => RequestContext.create(orm.em, work);

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
}, 30000);

const openWallet = (amount: string) => {
  const playerId = crypto.randomUUID();
  return inContext(() => uc.createWallet.execute({ playerId, initialBalance: brl(amount) })).then(
    (wallet) => ({ walletId: wallet.id, playerId }),
  );
};

const betCommand = (
  walletId: string,
  playerId: string,
  amount: string,
  externalTransactionId = crypto.randomUUID(),
) => ({
  idempotencyKey: `provider-a:${externalTransactionId}`,
  providerId: 'provider-a',
  externalTransactionId,
  playerId,
  walletId,
  roundId: 'round-1',
  gameId: 'game-1',
  kind: WagerTransactionKind.Bet,
  money: brl(amount),
});

describe('wallet concurrency', () => {
  it('applies 50 identical parallel submissions exactly once', async () => {
    const { walletId, playerId } = await openWallet('1000.00');
    const command = betCommand(walletId, playerId, '25.00');

    const results = await Promise.all(
      Array.from({ length: 50 }, () => inContext(() => uc.submit.execute(command))),
    );

    expect(results.every((r) => r.status === WagerTransactionStatus.Processed)).toBe(true);
    expect(results.filter((r) => !r.idempotentReplay)).toHaveLength(1);

    const wallet = await inContext(() => uc.getWallet.execute(walletId));
    expect(wallet.balance).toEqual(brl('975.00'));

    const ledger = await inContext(() => uc.getLedger.execute({ walletId, limit: 200 }));
    expect(ledger.entries.filter((e) => e.direction === LedgerDirection.Debit)).toHaveLength(1);
  }, 30000);

  it('lets only one of two racing bets win when the balance covers just one', async () => {
    const { walletId, playerId } = await openWallet('100.00');

    const results = await Promise.all([
      inContext(() => uc.submit.execute(betCommand(walletId, playerId, '80.00'))),
      inContext(() => uc.submit.execute(betCommand(walletId, playerId, '80.00'))),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(
      [WagerTransactionStatus.Processed, WagerTransactionStatus.Rejected].sort(),
    );
    expect(results.find((r) => r.status === WagerTransactionStatus.Rejected)?.failureCode).toBe(
      FailureCode.InsufficientFunds,
    );

    const wallet = await inContext(() => uc.getWallet.execute(walletId));
    expect(wallet.balance).toEqual(brl('20.00'));

    const ledger = await inContext(() => uc.getLedger.execute({ walletId, limit: 200 }));
    expect(ledger.entries.filter((e) => e.direction === LedgerDirection.Debit)).toHaveLength(1);
  }, 30000);

  it('stays reconcilable after a burst of concurrent bets on the same wallet', async () => {
    const { walletId, playerId } = await openWallet('1000.00');

    await Promise.all(
      Array.from({ length: 20 }, () =>
        inContext(() => uc.submit.execute(betCommand(walletId, playerId, '10.00'))),
      ),
    );

    const report = await inContext(() => uc.reconcile.execute(walletId));
    expect(report.consistent).toBe(true);
    expect(report.storedBalance).toEqual(brl('800.00'));
  }, 30000);

  it('holds a refund that races ahead of its reference, then settles it', async () => {
    const { walletId, playerId } = await openWallet('100.00');
    const betExternalId = crypto.randomUUID();

    const [betResult, refundResult] = await Promise.all([
      inContext(() => uc.submit.execute(betCommand(walletId, playerId, '25.00', betExternalId))),
      inContext(() =>
        uc.submit.execute({
          ...betCommand(walletId, playerId, '25.00'),
          kind: WagerTransactionKind.Refund,
          referenceExternalTransactionId: betExternalId,
        }),
      ),
    ]);

    expect(betResult.status).toBe(WagerTransactionStatus.Processed);
    expect([WagerTransactionStatus.PendingReference, WagerTransactionStatus.Processed]).toContain(
      refundResult.status,
    );

    clock.advance(60_000);
    await inContext(() => uc.reprocess.execute());

    const wallet = await inContext(() => uc.getWallet.execute(walletId));
    expect(wallet.balance).toEqual(brl('100.00'));
  }, 30000);
});

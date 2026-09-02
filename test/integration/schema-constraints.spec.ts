import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { MikroORM } from '@mikro-orm/postgresql';
import { createTestOrm, truncateAll } from './orm-fixture.js';
import { WalletLedgerEntryRepository } from '../../src/infrastructure/database/repositories/wallet-ledger-entry.repository.js';
import { WagerTransactionRepository } from '../../src/infrastructure/database/repositories/wager-transaction.repository.js';
import { WalletLedgerEntry } from '../../src/domain/entities/wallet-ledger-entry.js';
import { WagerTransaction } from '../../src/domain/entities/wager-transaction.js';
import { Money } from '../../src/domain/entities/money.js';
import { LedgerDirection } from '../../src/domain/enums/ledger-direction.enum.js';
import { WagerTransactionKind } from '../../src/domain/enums/wager-transaction-kind.enum.js';
import { WagerTransactionStatus } from '../../src/domain/enums/wager-transaction-status.enum.js';
import { FailureCode } from '../../src/domain/enums/failure-code.js';
import { ReferenceResolutionError } from '../../src/domain/errors/reference-resolution.error.js';

let orm: MikroORM;
const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });
const NOW = new Date('2026-09-01T00:00:00.000Z');
const uuid = () => crypto.randomUUID();

const anEntry = (): WalletLedgerEntry =>
  WalletLedgerEntry.create({
    id: uuid(),
    walletId: uuid(),
    transactionId: uuid(),
    direction: LedgerDirection.Debit,
    money: brl('10.00'),
    balanceBefore: brl('100.00'),
    balanceAfter: brl('90.00'),
    createdAt: NOW,
  });

const aProcessedReversal = (over: {
  referenceTransactionId: string;
  kind: WagerTransactionKind;
}): WagerTransaction =>
  WagerTransaction.rehydrate({
    id: uuid(),
    providerId: 'provider-a',
    externalTransactionId: uuid(),
    idempotencyKey: uuid(),
    payloadHash: 'hash',
    walletId: uuid(),
    playerId: uuid(),
    roundId: 'round-1',
    gameId: 'game-1',
    kind: over.kind,
    money: { amount: '10.00', currency: 'BRL' },
    referenceExternalTransactionId: 'ext-ref',
    createdAt: NOW,
    status: WagerTransactionStatus.Processed,
    referenceTransactionId: over.referenceTransactionId,
    processedAt: NOW,
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

describe('schema-enforced ledger immutability', () => {
  it('rejects a raw UPDATE on wallet_ledger_entries', async () => {
    const entry = anEntry();
    await new WalletLedgerEntryRepository(orm.em.fork()).save(entry);

    await expect(
      orm.em
        .getConnection()
        .execute(`update wallet_ledger_entries set amount = '1.00' where id = '${entry.id}'`),
    ).rejects.toThrow(/append-only/);
  });

  it('rejects a raw DELETE on wallet_ledger_entries', async () => {
    const entry = anEntry();
    await new WalletLedgerEntryRepository(orm.em.fork()).save(entry);

    await expect(
      orm.em.getConnection().execute(`delete from wallet_ledger_entries where id = '${entry.id}'`),
    ).rejects.toThrow(/append-only/);

    const rows = await orm.em
      .getConnection()
      .execute(`select count(*)::int as count from wallet_ledger_entries`);
    expect(rows[0]!.count).toBe(1);
  });
});

describe('schema-enforced single reversal per kind', () => {
  it('rejects a second PROCESSED reversal for the same (reference, kind)', async () => {
    const referenceTransactionId = uuid();
    const first = aProcessedReversal({ referenceTransactionId, kind: WagerTransactionKind.Refund });
    const second = aProcessedReversal({ referenceTransactionId, kind: WagerTransactionKind.Refund });

    await new WagerTransactionRepository(orm.em.fork()).save(first);

    await expect(new WagerTransactionRepository(orm.em.fork()).save(second)).rejects.toBeInstanceOf(
      ReferenceResolutionError,
    );
  });

  it('allows different reversal kinds to reference the same transaction', async () => {
    const referenceTransactionId = uuid();

    await new WagerTransactionRepository(orm.em.fork()).save(
      aProcessedReversal({ referenceTransactionId, kind: WagerTransactionKind.Refund }),
    );
    await new WagerTransactionRepository(orm.em.fork()).save(
      aProcessedReversal({ referenceTransactionId, kind: WagerTransactionKind.Rollback }),
    );

    const rows = await orm.em
      .getConnection()
      .execute(
        `select count(*)::int as count from wager_transactions where reference_transaction_id = '${referenceTransactionId}'`,
      );
    expect(rows[0]!.count).toBe(2);
  });

  it('does not constrain non-reversal transactions (null reference)', async () => {
    const repo = new WagerTransactionRepository(orm.em.fork());
    const bet = (): WagerTransaction =>
      WagerTransaction.create({
        id: uuid(),
        providerId: 'provider-a',
        externalTransactionId: uuid(),
        idempotencyKey: uuid(),
        payloadHash: 'hash',
        walletId: uuid(),
        playerId: uuid(),
        roundId: 'round-1',
        gameId: 'game-1',
        kind: WagerTransactionKind.Bet,
        money: brl('10.00'),
        createdAt: NOW,
      });

    await repo.save(bet());
    await expect(new WagerTransactionRepository(orm.em.fork()).save(bet())).resolves.toBeUndefined();
  });

  it('keeps FailureCode.ReferenceAlreadyReversed on the surfaced error', async () => {
    const referenceTransactionId = uuid();
    await new WagerTransactionRepository(orm.em.fork()).save(
      aProcessedReversal({ referenceTransactionId, kind: WagerTransactionKind.Rollback }),
    );

    const promise = new WagerTransactionRepository(orm.em.fork()).save(
      aProcessedReversal({ referenceTransactionId, kind: WagerTransactionKind.Rollback }),
    );
    await expect(promise).rejects.toMatchObject({ code: FailureCode.ReferenceAlreadyReversed });
  });
});

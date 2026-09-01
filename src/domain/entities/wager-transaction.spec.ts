import { describe, expect, it } from 'bun:test';
import { WagerTransaction, type CreateWagerTransactionProps } from './wager-transaction.js';
import { Money } from './money.js';
import { WagerTransactionKind } from '../enums/wager-transaction-kind.enum.js';
import { WagerTransactionStatus } from '../enums/wager-transaction-status.enum.js';
import { LedgerDirection } from '../enums/ledger-direction.enum.js';
import { FailureCode } from '../enums/failure-code.js';
import { InvalidTransactionStateError } from '../errors/invalid-transaction-state.error.js';
import { InvalidLedgerEntryError } from '../errors/invalid-ledger-entry.error.js';
import { ReferenceResolutionError } from '../errors/reference-resolution.error.js';

const NOW = new Date('2026-09-01T00:00:00.000Z');

const props = (over: Partial<CreateWagerTransactionProps> = {}): CreateWagerTransactionProps => ({
  id: 'tx-1',
  providerId: 'provider-a',
  externalTransactionId: 'ext-1',
  idempotencyKey: 'provider-a:ext-1',
  payloadHash: 'hash-1',
  walletId: 'wallet-1',
  playerId: 'player-1',
  roundId: 'round-1',
  gameId: 'game-1',
  kind: WagerTransactionKind.Bet,
  money: Money.from({ amount: '25.00', currency: 'BRL' }),
  createdAt: NOW,
  ...over,
});

const create = (over: Partial<CreateWagerTransactionProps> = {}) => WagerTransaction.create(props(over));

describe('WagerTransaction.create', () => {
  it('is born PENDING', () => {
    expect(create().status).toBe(WagerTransactionStatus.Pending);
  });

  it('requires a reference for REFUND and ROLLBACK', () => {
    expect(() => create({ kind: WagerTransactionKind.Refund })).toThrow(ReferenceResolutionError);
    expect(() => create({ kind: WagerTransactionKind.Rollback })).toThrow(ReferenceResolutionError);
  });

  it('accepts REFUND/ROLLBACK when a reference is present', () => {
    const refund = create({
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'ext-bet',
    });
    expect(refund.status).toBe(WagerTransactionStatus.Pending);
  });

  it('does not require a reference for BET/WIN/LOSS', () => {
    for (const kind of [WagerTransactionKind.Bet, WagerTransactionKind.Win, WagerTransactionKind.Loss]) {
      expect(create({ kind }).requiresReference()).toBe(false);
    }
  });
});

describe('WagerTransaction domain queries', () => {
  it('affectsBalance is false only for LOSS', () => {
    expect(create({ kind: WagerTransactionKind.Loss }).affectsBalance()).toBe(false);
    for (const kind of [
      WagerTransactionKind.Bet,
      WagerTransactionKind.Win,
      WagerTransactionKind.Refund,
      WagerTransactionKind.Rollback,
      WagerTransactionKind.Opening,
    ]) {
      expect(create({ kind, referenceExternalTransactionId: 'r' }).affectsBalance()).toBe(true);
    }
  });

  it('matchesPayload compares the stored hash', () => {
    const tx = create({ payloadHash: 'abc' });
    expect(tx.matchesPayload('abc')).toBe(true);
    expect(tx.matchesPayload('xyz')).toBe(false);
  });

  describe('ledgerDirectionFor', () => {
    it('maps BET to DEBIT and WIN/REFUND/OPENING to CREDIT', () => {
      expect(create({ kind: WagerTransactionKind.Bet }).ledgerDirectionFor()).toBe(LedgerDirection.Debit);
      expect(create({ kind: WagerTransactionKind.Win }).ledgerDirectionFor()).toBe(LedgerDirection.Credit);
      expect(
        create({ kind: WagerTransactionKind.Refund, referenceExternalTransactionId: 'r' }).ledgerDirectionFor(),
      ).toBe(LedgerDirection.Credit);
      expect(create({ kind: WagerTransactionKind.Opening }).ledgerDirectionFor()).toBe(
        LedgerDirection.Credit,
      );
    });

    it('inverts the reference direction for ROLLBACK', () => {
      const rollback = create({
        kind: WagerTransactionKind.Rollback,
        referenceExternalTransactionId: 'r',
      });
      const bet = create({ kind: WagerTransactionKind.Bet });
      const win = create({ kind: WagerTransactionKind.Win });
      expect(rollback.ledgerDirectionFor(bet)).toBe(LedgerDirection.Credit);
      expect(rollback.ledgerDirectionFor(win)).toBe(LedgerDirection.Debit);
    });

    it('throws for LOSS and for ROLLBACK without a reference', () => {
      expect(() => create({ kind: WagerTransactionKind.Loss }).ledgerDirectionFor()).toThrow(
        InvalidLedgerEntryError,
      );
      expect(() =>
        create({ kind: WagerTransactionKind.Rollback, referenceExternalTransactionId: 'r' }).ledgerDirectionFor(),
      ).toThrow(InvalidLedgerEntryError);
    });
  });
});

describe('WagerTransaction state machine', () => {
  it('PENDING -> PROCESSED records reference and processedAt', () => {
    const tx = create();
    tx.markProcessed('internal-ref-id', NOW);
    expect(tx.status).toBe(WagerTransactionStatus.Processed);
    expect(tx.referenceTransactionId).toBe('internal-ref-id');
    expect(tx.processedAt).toBe(NOW);
    expect(tx.isTerminal()).toBe(true);
  });

  it('PENDING -> PENDING_REFERENCE -> PROCESSED', () => {
    const tx = create({ kind: WagerTransactionKind.Rollback, referenceExternalTransactionId: 'r' });
    tx.markPendingReference();
    expect(tx.status).toBe(WagerTransactionStatus.PendingReference);
    expect(tx.isTerminal()).toBe(false);
    tx.markProcessed('ref', NOW);
    expect(tx.status).toBe(WagerTransactionStatus.Processed);
  });

  it('reject and fail are terminal and carry a failure code', () => {
    const rejected = create();
    rejected.reject(FailureCode.InsufficientFunds);
    expect(rejected.status).toBe(WagerTransactionStatus.Rejected);
    expect(rejected.failureCode).toBe(FailureCode.InsufficientFunds);

    const failed = create();
    failed.fail(FailureCode.PermanentInfrastructureError);
    expect(failed.status).toBe(WagerTransactionStatus.Failed);
    expect(failed.failureCode).toBe(FailureCode.PermanentInfrastructureError);
  });

  it('rejects any transition out of a terminal state', () => {
    const tx = create();
    tx.markProcessed(undefined, NOW);
    expect(() => tx.markProcessed(undefined, NOW)).toThrow(InvalidTransactionStateError);
    expect(() => tx.reject(FailureCode.InsufficientFunds)).toThrow(InvalidTransactionStateError);
    expect(() => tx.fail(FailureCode.PermanentInfrastructureError)).toThrow(InvalidTransactionStateError);
    expect(() => tx.markPendingReference()).toThrow(InvalidTransactionStateError);
  });

  it('cannot go from PENDING_REFERENCE back to PENDING_REFERENCE', () => {
    const tx = create({ kind: WagerTransactionKind.Refund, referenceExternalTransactionId: 'r' });
    tx.markPendingReference();
    expect(() => tx.markPendingReference()).toThrow(InvalidTransactionStateError);
  });
});

describe('WagerTransaction.rehydrate', () => {
  it('restores a terminal persisted transaction without revalidation', () => {
    const tx = WagerTransaction.rehydrate({
      ...props({ kind: WagerTransactionKind.Refund, referenceExternalTransactionId: 'ext-bet' }),
      money: { amount: '25.00', currency: 'BRL' },
      status: WagerTransactionStatus.Rejected,
      failureCode: FailureCode.ReferenceNotFound,
    });
    expect(tx.status).toBe(WagerTransactionStatus.Rejected);
    expect(tx.failureCode).toBe(FailureCode.ReferenceNotFound);
    expect(tx.isTerminal()).toBe(true);
  });
});

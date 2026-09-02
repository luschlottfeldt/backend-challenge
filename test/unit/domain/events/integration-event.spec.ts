import { describe, expect, it } from 'bun:test';
import { Wallet } from '../../../../src/domain/entities/wallet.js';
import { WagerTransaction } from '../../../../src/domain/entities/wager-transaction.js';
import { Money } from '../../../../src/domain/entities/money.js';
import { WagerTransactionKind } from '../../../../src/domain/enums/wager-transaction-kind.enum.js';
import { LedgerDirection } from '../../../../src/domain/enums/ledger-direction.enum.js';
import { FailureCode } from '../../../../src/domain/enums/failure-code.js';
import type { EventContext } from '../../../../src/domain/events/event-context.js';
import { WalletBalanceChanged } from '../../../../src/domain/events/wallet-balance-changed.event.js';
import { WagerTransactionProcessed } from '../../../../src/domain/events/wager-transaction-processed.event.js';
import { WagerTransactionRejected } from '../../../../src/domain/events/wager-transaction-rejected.event.js';
import { WagerTransactionPendingReference } from '../../../../src/domain/events/wager-transaction-pending-reference.event.js';

const NOW = new Date('2026-09-01T12:00:00.000Z');
const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });

const ctx = (over: Partial<EventContext> = {}): EventContext => ({
  eventId: 'event-1',
  correlationId: 'corr-1',
  occurredAt: NOW,
  ...over,
});

const openWallet = () =>
  Wallet.open({
    id: 'wallet-1',
    playerId: 'player-1',
    initialBalance: brl('100.00'),
    openingTransactionId: 'opening',
    openingLedgerEntryId: 'opening-entry',
    now: NOW,
  }).wallet;

const bet = () =>
  WagerTransaction.create({
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
    money: brl('30.00'),
    createdAt: NOW,
  });

describe('IntegrationEvent.toJSON', () => {
  it('serializes the envelope with an ISO occurredAt and type-carried metadata', () => {
    const event = WagerTransactionProcessed.from(bet(), ctx());
    const json = event.toJSON();
    expect(json).toMatchObject({
      eventId: 'event-1',
      eventType: 'WagerTransactionProcessed',
      aggregateId: 'tx-1',
      correlationId: 'corr-1',
      occurredAt: '2026-09-01T12:00:00.000Z',
      version: 1,
    });
  });

  it('omits causationId from the serialized payload when absent', () => {
    const event = WagerTransactionProcessed.from(bet(), ctx());
    expect('causationId' in JSON.parse(JSON.stringify(event))).toBe(false);
  });

  it('keeps causationId when provided', () => {
    const event = WagerTransactionProcessed.from(bet(), ctx({ causationId: 'cause-1' }));
    expect(JSON.parse(JSON.stringify(event)).causationId).toBe('cause-1');
  });
});

describe('WalletBalanceChanged.from', () => {
  it('carries MoneyProps (not Money instances) and the wallet version', () => {
    const wallet = openWallet();
    const entry = wallet.debit(brl('30.00'), {
      transactionId: 'tx-1',
      ledgerEntryId: 'entry-1',
      occurredAt: NOW,
    });
    const json = WalletBalanceChanged.from(wallet, entry, ctx()).toJSON();
    expect(json.aggregateId).toBe('wallet-1');
    expect(json.data.direction).toBe(LedgerDirection.Debit);
    expect(json.data.money).toEqual({ amount: '30.00', currency: 'BRL' });
    expect(json.data.balanceBefore).toEqual({ amount: '100.00', currency: 'BRL' });
    expect(json.data.balanceAfter).toEqual({ amount: '70.00', currency: 'BRL' });
    expect(json.data.walletVersion).toBe(2);
    expect(JSON.stringify(json)).not.toContain('Decimal');
  });
});

describe('WagerTransactionProcessed.from', () => {
  it('reports whether the balance was affected', () => {
    const processedBet = WagerTransactionProcessed.from(bet(), ctx());
    expect(processedBet.data.affectedBalance).toBe(true);
  });
});

describe('WagerTransactionRejected.from', () => {
  it('carries the failure code', () => {
    const json = WagerTransactionRejected.from(bet(), FailureCode.InsufficientFunds, ctx()).toJSON();
    expect(json.eventType).toBe('WagerTransactionRejected');
    expect(json.data.failureCode).toBe(FailureCode.InsufficientFunds);
  });
});

describe('WagerTransactionPendingReference.from', () => {
  it('carries the unresolved provider reference id', () => {
    const rollback = WagerTransaction.create({
      id: 'tx-2',
      providerId: 'provider-a',
      externalTransactionId: 'ext-2',
      idempotencyKey: 'provider-a:ext-2',
      payloadHash: 'hash-2',
      walletId: 'wallet-1',
      playerId: 'player-1',
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Rollback,
      referenceExternalTransactionId: 'ext-bet',
      money: brl('30.00'),
      createdAt: NOW,
    });
    const json = WagerTransactionPendingReference.from(rollback, ctx()).toJSON();
    expect(json.eventType).toBe('WagerTransactionPendingReference');
    expect(json.data.referenceExternalTransactionId).toBe('ext-bet');
  });
});

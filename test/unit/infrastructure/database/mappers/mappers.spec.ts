import { describe, expect, it } from 'bun:test';
import { Wallet } from '../../../../../src/domain/entities/wallet.js';
import { WagerTransaction } from '../../../../../src/domain/entities/wager-transaction.js';
import { Money } from '../../../../../src/domain/entities/money.js';
import { InboxMessage } from '../../../../../src/domain/entities/inbox-message.js';
import { OutboxMessage } from '../../../../../src/domain/entities/outbox-message.js';
import { WagerTransactionKind } from '../../../../../src/domain/enums/wager-transaction-kind.enum.js';
import { WagerTransactionStatus } from '../../../../../src/domain/enums/wager-transaction-status.enum.js';
import { FailureCode } from '../../../../../src/domain/enums/failure-code.js';
import { WagerTransactionProcessed } from '../../../../../src/domain/events/wager-transaction-processed.event.js';
import { walletMapper } from '../../../../../src/infrastructure/database/mappers/wallet.mapper.js';
import { wagerTransactionMapper } from '../../../../../src/infrastructure/database/mappers/wager-transaction.mapper.js';
import { walletLedgerEntryMapper } from '../../../../../src/infrastructure/database/mappers/wallet-ledger-entry.mapper.js';
import { inboxMessageMapper } from '../../../../../src/infrastructure/database/mappers/inbox-message.mapper.js';
import { outboxMessageMapper } from '../../../../../src/infrastructure/database/mappers/outbox-message.mapper.js';

const NOW = new Date('2026-09-01T00:00:00.000Z');
const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });

describe('walletMapper', () => {
  it('round-trips a wallet through persistence', () => {
    const { wallet } = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: brl('100.00'),
      openingTransactionId: 'op',
      openingLedgerEntryId: 'op-e',
      now: NOW,
    });
    const back = walletMapper.toDomain(walletMapper.toPersistence(wallet));
    expect(back.balance.toString()).toBe('100.00');
    expect(back.version).toBe(1);
    expect(back.playerId).toBe('player-1');
  });
});

describe('wagerTransactionMapper', () => {
  const build = () =>
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
      money: brl('25.00'),
      createdAt: NOW,
    });

  it('round-trips a fresh PENDING transaction (null optionals become null then undefined)', () => {
    const row = wagerTransactionMapper.toPersistence(build());
    expect(row.failureCode).toBeNull();
    expect(row.processedAt).toBeNull();
    expect(row.referenceCheckAttempts).toBe(0);
    const back = wagerTransactionMapper.toDomain(row);
    expect(back.status).toBe(WagerTransactionStatus.Pending);
    expect(back.failureCode).toBeUndefined();
    expect(back.money.toString()).toBe('25.00');
  });

  it('round-trips a terminal REJECTED transaction', () => {
    const tx = build();
    tx.reject(FailureCode.InsufficientFunds);
    const back = wagerTransactionMapper.toDomain(wagerTransactionMapper.toPersistence(tx));
    expect(back.status).toBe(WagerTransactionStatus.Rejected);
    expect(back.failureCode).toBe(FailureCode.InsufficientFunds);
    expect(back.isTerminal()).toBe(true);
  });

  it('round-trips a PROCESSED transaction with a resolved reference and processedAt', () => {
    const tx = build();
    tx.markProcessed('internal-ref', NOW);
    const back = wagerTransactionMapper.toDomain(wagerTransactionMapper.toPersistence(tx));
    expect(back.referenceTransactionId).toBe('internal-ref');
    expect(back.processedAt).toEqual(NOW);
  });
});

describe('walletLedgerEntryMapper', () => {
  it('round-trips a ledger entry and keeps it balanced', () => {
    const { wallet } = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: brl('100.00'),
      openingTransactionId: 'op',
      openingLedgerEntryId: 'op-e',
      now: NOW,
    });
    const entry = wallet.debit(brl('30.00'), {
      transactionId: 'tx-1',
      ledgerEntryId: 'entry-1',
      occurredAt: NOW,
    });
    const back = walletLedgerEntryMapper.toDomain(walletLedgerEntryMapper.toPersistence(entry));
    expect(back.isBalanced()).toBe(true);
    expect(back.balanceBefore.toString()).toBe('100.00');
    expect(back.balanceAfter.toString()).toBe('70.00');
  });
});

describe('inboxMessageMapper', () => {
  it('round-trips processed and unprocessed messages', () => {
    const fresh = InboxMessage.receive({
      messageId: 'msg-1',
      consumerName: 'c',
      payloadHash: 'h',
      receivedAt: NOW,
    });
    expect(inboxMessageMapper.toPersistence(fresh).processedAt).toBeNull();

    fresh.markProcessed(NOW);
    const back = inboxMessageMapper.toDomain(inboxMessageMapper.toPersistence(fresh));
    expect(back.isProcessed()).toBe(true);
  });
});

describe('outboxMessageMapper', () => {
  it('round-trips an enqueued outbox message', () => {
    const event = WagerTransactionProcessed.from(
      WagerTransaction.create({
        id: 'tx-1',
        providerId: 'p',
        externalTransactionId: 'e',
        idempotencyKey: 'p:e',
        payloadHash: 'h',
        walletId: 'w',
        playerId: 'pl',
        roundId: 'r',
        gameId: 'g',
        kind: WagerTransactionKind.Loss,
        money: brl('5.00'),
        createdAt: NOW,
      }),
      { eventId: 'event-1', correlationId: 'corr-1', occurredAt: NOW },
    );
    const message = OutboxMessage.enqueue(event);
    const back = outboxMessageMapper.toDomain(outboxMessageMapper.toPersistence(message));
    expect(back.id).toBe('event-1');
    expect(back.isPending()).toBe(true);
    expect(back.payload.eventType).toBe('WagerTransactionProcessed');
  });
});

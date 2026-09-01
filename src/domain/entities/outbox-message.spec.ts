import { describe, expect, it } from 'bun:test';
import { OutboxMessage } from './outbox-message.js';
import { WagerTransactionRejected } from '../events/wager-transaction-rejected.event.js';
import { WagerTransaction } from './wager-transaction.js';
import { Money } from './money.js';
import { WagerTransactionKind } from '../enums/wager-transaction-kind.enum.js';
import { FailureCode } from '../enums/failure-code.js';
import { InvalidMessageStateError } from '../errors/invalid-message-state.error.js';

const NOW = new Date('2026-09-01T00:00:00.000Z');

const event = () =>
  WagerTransactionRejected.from(
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
      money: Money.from({ amount: '30.00', currency: 'BRL' }),
      createdAt: NOW,
    }),
    FailureCode.InsufficientFunds,
    { eventId: 'event-1', correlationId: 'corr-1', occurredAt: NOW },
  );

describe('OutboxMessage.enqueue', () => {
  it('derives its id from the event id and stores the serialized envelope', () => {
    const message = OutboxMessage.enqueue(event());
    expect(message.id).toBe('event-1');
    expect(message.aggregateId).toBe('tx-1');
    expect(message.eventType).toBe('WagerTransactionRejected');
    expect(message.attempts).toBe(0);
    expect(message.payload.eventType).toBe('WagerTransactionRejected');
    expect(JSON.stringify(message.payload)).not.toContain('undefined');
  });

  it('is pending and due immediately', () => {
    const message = OutboxMessage.enqueue(event());
    expect(message.isPending()).toBe(true);
    expect(message.isDue(NOW)).toBe(true);
  });
});

describe('OutboxMessage.scheduleRetry', () => {
  it('increments attempts and pushes nextAttemptAt out with exponential backoff', () => {
    const message = OutboxMessage.enqueue(event());
    message.scheduleRetry(NOW);
    expect(message.attempts).toBe(1);
    expect(message.nextAttemptAt).toEqual(new Date(NOW.getTime() + 5_000));
    expect(message.isDue(NOW)).toBe(false);

    message.scheduleRetry(NOW);
    expect(message.attempts).toBe(2);
    expect(message.nextAttemptAt).toEqual(new Date(NOW.getTime() + 10_000));
  });

  it('becomes due again once nextAttemptAt passes', () => {
    const message = OutboxMessage.enqueue(event());
    message.scheduleRetry(NOW);
    expect(message.isDue(new Date(NOW.getTime() + 5_001))).toBe(true);
  });
});

describe('OutboxMessage.markPublished', () => {
  it('marks once and rejects a second publish or retry', () => {
    const message = OutboxMessage.enqueue(event());
    message.markPublished(NOW);
    expect(message.isPending()).toBe(false);
    expect(message.isDue(NOW)).toBe(false);
    expect(() => message.markPublished(NOW)).toThrow(InvalidMessageStateError);
    expect(() => message.scheduleRetry(NOW)).toThrow(InvalidMessageStateError);
  });
});

describe('OutboxMessage.rehydrate', () => {
  it('restores publisher progress from persistence', () => {
    const message = OutboxMessage.rehydrate({
      id: 'event-1',
      aggregateId: 'tx-1',
      eventType: 'WagerTransactionRejected',
      payload: { eventType: 'WagerTransactionRejected' },
      occurredAt: NOW,
      attempts: 3,
      nextAttemptAt: new Date(NOW.getTime() + 20_000),
    });
    expect(message.attempts).toBe(3);
    expect(message.isPending()).toBe(true);
    expect(message.isDue(NOW)).toBe(false);
  });
});

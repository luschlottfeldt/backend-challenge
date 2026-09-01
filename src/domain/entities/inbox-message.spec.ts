import { describe, expect, it } from 'bun:test';
import { InboxMessage } from './inbox-message.js';
import { InvalidMessageStateError } from '../errors/invalid-message-state.error.js';

const NOW = new Date('2026-09-01T00:00:00.000Z');
const LATER = new Date('2026-09-01T00:00:05.000Z');

const receive = () =>
  InboxMessage.receive({
    messageId: 'msg-1',
    consumerName: 'wager-consumer',
    payloadHash: 'hash-1',
    receivedAt: NOW,
  });

describe('InboxMessage', () => {
  it('is unprocessed when received', () => {
    const message = receive();
    expect(message.isProcessed()).toBe(false);
    expect(message.processedAt).toBeUndefined();
  });

  it('records the processing timestamp exactly once', () => {
    const message = receive();
    message.markProcessed(LATER);
    expect(message.isProcessed()).toBe(true);
    expect(message.processedAt).toBe(LATER);
    expect(() => message.markProcessed(LATER)).toThrow(InvalidMessageStateError);
  });

  it('rehydrates a processed message from persistence', () => {
    const message = InboxMessage.rehydrate({
      messageId: 'msg-1',
      consumerName: 'wager-consumer',
      payloadHash: 'hash-1',
      receivedAt: NOW,
      processedAt: LATER,
    });
    expect(message.isProcessed()).toBe(true);
  });
});

import { OutboxMessage } from '../../../domain/entities/outbox-message.js';

export interface OutboxMessageRow {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt: Date | null | undefined;
  publishedAt: Date | null | undefined;
}

export const outboxMessageMapper = {
  toDomain(row: OutboxMessageRow): OutboxMessage {
    return OutboxMessage.rehydrate({
      id: row.id,
      aggregateId: row.aggregateId,
      eventType: row.eventType,
      payload: row.payload,
      occurredAt: row.occurredAt,
      attempts: row.attempts,
      nextAttemptAt: row.nextAttemptAt ?? undefined,
      publishedAt: row.publishedAt ?? undefined,
    });
  },

  toPersistence(message: OutboxMessage): OutboxMessageRow {
    return {
      id: message.id,
      aggregateId: message.aggregateId,
      eventType: message.eventType,
      payload: message.payload as Record<string, unknown>,
      occurredAt: message.occurredAt,
      attempts: message.attempts,
      nextAttemptAt: message.nextAttemptAt ?? null,
      publishedAt: message.publishedAt ?? null,
    };
  },
};

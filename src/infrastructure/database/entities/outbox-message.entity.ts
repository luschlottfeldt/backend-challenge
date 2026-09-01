import { defineEntity, p } from '@mikro-orm/postgresql';

export const OutboxMessageSchema = defineEntity({
  name: 'OutboxMessage',
  tableName: 'outbox_messages',
  properties: {
    id: p.uuid().primary(),
    aggregateId: p.uuid(),
    eventType: p.string(),
    payload: p.json<Record<string, unknown>>(),
    occurredAt: p.datetime(),
    attempts: p.integer().default(0),
    nextAttemptAt: p.datetime().nullable(),
    publishedAt: p.datetime().nullable(),
  },
  indexes: [{ properties: ['nextAttemptAt'] }],
});

export class OutboxMessageOrmEntity extends OutboxMessageSchema.class {}
OutboxMessageSchema.setClass(OutboxMessageOrmEntity);

import { defineEntity, p } from '@mikro-orm/postgresql';

export const InboxMessageSchema = defineEntity({
  name: 'InboxMessage',
  tableName: 'inbox_messages',
  properties: {
    consumerName: p.string().primary(),
    messageId: p.string().primary(),
    payloadHash: p.string(),
    receivedAt: p.datetime(),
    processedAt: p.datetime().nullable(),
  },
});

export class InboxMessageOrmEntity extends InboxMessageSchema.class {}
InboxMessageSchema.setClass(InboxMessageOrmEntity);

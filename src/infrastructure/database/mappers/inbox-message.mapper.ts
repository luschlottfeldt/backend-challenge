import { InboxMessage } from '../../../domain/entities/inbox-message.js';

export interface InboxMessageRow {
  consumerName: string;
  messageId: string;
  payloadHash: string;
  receivedAt: Date;
  processedAt: Date | null | undefined;
}

export const inboxMessageMapper = {
  toDomain(row: InboxMessageRow): InboxMessage {
    return InboxMessage.rehydrate({
      consumerName: row.consumerName,
      messageId: row.messageId,
      payloadHash: row.payloadHash,
      receivedAt: row.receivedAt,
      processedAt: row.processedAt ?? undefined,
    });
  },

  toPersistence(message: InboxMessage): InboxMessageRow {
    return {
      consumerName: message.consumerName,
      messageId: message.messageId,
      payloadHash: message.payloadHash,
      receivedAt: message.receivedAt,
      processedAt: message.processedAt ?? null,
    };
  },
};

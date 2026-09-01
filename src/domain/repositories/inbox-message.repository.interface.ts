import type { InboxMessage } from '../entities/inbox-message.js';

export interface IInboxMessageRepository {
  findByMessageId(consumerName: string, messageId: string): Promise<InboxMessage | null>;
  save(message: InboxMessage): Promise<void>;
}

import type { OutboxMessage } from '../entities/outbox-message.js';

export interface IOutboxMessageRepository {
  findDue(now: Date, limit: number): Promise<OutboxMessage[]>;
  oldestUnpublishedAt(): Promise<Date | null>;
  save(message: OutboxMessage): Promise<void>;
}

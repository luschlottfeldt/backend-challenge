import type { OutboxMessage } from '../entities/outbox-message.js';

export interface IOutboxMessageRepository {
  findDue(now: Date, limit: number): Promise<OutboxMessage[]>;
  save(message: OutboxMessage): Promise<void>;
}

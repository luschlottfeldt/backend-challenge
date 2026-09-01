import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import type { IOutboxMessageRepository } from '../../../domain/repositories/outbox-message.repository.interface.js';
import type { OutboxMessage } from '../../../domain/entities/outbox-message.js';

@Injectable()
export class OutboxMessageRepository implements IOutboxMessageRepository {
  constructor(private readonly em: EntityManager) {}

  async findDue(_now: Date, _limit: number): Promise<OutboxMessage[]> {
    throw new Error('Not implemented');
  }

  async save(_message: OutboxMessage): Promise<void> {
    throw new Error('Not implemented');
  }
}

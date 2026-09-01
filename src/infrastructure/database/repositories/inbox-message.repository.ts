import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import type { IInboxMessageRepository } from '../../../domain/repositories/inbox-message.repository.interface.js';
import type { InboxMessage } from '../../../domain/entities/inbox-message.js';

@Injectable()
export class InboxMessageRepository implements IInboxMessageRepository {
  constructor(private readonly em: EntityManager) {}

  async findByMessageId(_consumerName: string, _messageId: string): Promise<InboxMessage | null> {
    throw new Error('Not implemented');
  }

  async save(_message: InboxMessage): Promise<void> {
    throw new Error('Not implemented');
  }
}

import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import type { IInboxMessageRepository } from '../../../domain/repositories/inbox-message.repository.interface.js';
import type { InboxMessage } from '../../../domain/entities/inbox-message.js';
import { InboxMessageOrmEntity } from '../entities/inbox-message.entity.js';
import { inboxMessageMapper } from '../mappers/inbox-message.mapper.js';

@Injectable()
export class InboxMessageRepository implements IInboxMessageRepository {
  constructor(private readonly em: EntityManager) {}

  async findByMessageId(consumerName: string, messageId: string): Promise<InboxMessage | null> {
    const row = await this.em.findOne(InboxMessageOrmEntity, { consumerName, messageId });
    return row ? inboxMessageMapper.toDomain(row) : null;
  }

  async save(message: InboxMessage): Promise<void> {
    const row = inboxMessageMapper.toPersistence(message);
    const existing = await this.em.findOne(InboxMessageOrmEntity, {
      consumerName: row.consumerName,
      messageId: row.messageId,
    });

    if (existing) {
      this.em.assign(existing, row);
    } else {
      this.em.persist(this.em.create(InboxMessageOrmEntity, row));
    }

    await this.em.flush();
  }
}

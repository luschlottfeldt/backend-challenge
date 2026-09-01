import { Injectable } from '@nestjs/common';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import type { IOutboxMessageRepository } from '../../../domain/repositories/outbox-message.repository.interface.js';
import type { OutboxMessage } from '../../../domain/entities/outbox-message.js';
import { OutboxMessageOrmEntity } from '../entities/outbox-message.entity.js';
import { outboxMessageMapper } from '../mappers/outbox-message.mapper.js';

@Injectable()
export class OutboxMessageRepository implements IOutboxMessageRepository {
  constructor(private readonly em: EntityManager) {}

  async findDue(now: Date, limit: number): Promise<OutboxMessage[]> {
    const rows = await this.em.find(
      OutboxMessageOrmEntity,
      {
        publishedAt: null,
        $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
      },
      {
        orderBy: { nextAttemptAt: 'asc' },
        limit,
        lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
      },
    );
    return rows.map((row) => outboxMessageMapper.toDomain(row));
  }

  async save(message: OutboxMessage): Promise<void> {
    const row = outboxMessageMapper.toPersistence(message);
    const existing = await this.em.findOne(OutboxMessageOrmEntity, { id: row.id });

    if (existing) {
      this.em.assign(existing, row);
    } else {
      this.em.persist(this.em.create(OutboxMessageOrmEntity, row));
    }

    await this.em.flush();
  }
}

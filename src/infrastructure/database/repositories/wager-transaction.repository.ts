import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import type { IWagerTransactionRepository } from '../../../domain/repositories/wager-transaction.repository.interface.js';
import type { WagerTransaction } from '../../../domain/entities/wager-transaction.js';
import { WagerTransactionStatus } from '../../../domain/enums/wager-transaction-status.enum.js';
import type { WagerTransactionKind } from '../../../domain/enums/wager-transaction-kind.enum.js';
import { WagerTransactionOrmEntity } from '../entities/wager-transaction.entity.js';
import { wagerTransactionMapper } from '../mappers/wager-transaction.mapper.js';
import { persistOrConflict } from '../persist.js';

@Injectable()
export class WagerTransactionRepository implements IWagerTransactionRepository {
  constructor(private readonly em: EntityManager) {}

  async findById(id: string): Promise<WagerTransaction | null> {
    const row = await this.em.findOne(WagerTransactionOrmEntity, { id });
    return row ? wagerTransactionMapper.toDomain(row) : null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | null> {
    const row = await this.em.findOne(WagerTransactionOrmEntity, { idempotencyKey });
    return row ? wagerTransactionMapper.toDomain(row) : null;
  }

  async findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    const row = await this.em.findOne(WagerTransactionOrmEntity, {
      providerId,
      externalTransactionId,
    });
    return row ? wagerTransactionMapper.toDomain(row) : null;
  }

  async findProcessedReversal(
    referenceTransactionId: string,
    kind: WagerTransactionKind,
  ): Promise<WagerTransaction | null> {
    const row = await this.em.findOne(WagerTransactionOrmEntity, {
      referenceTransactionId,
      kind,
      status: WagerTransactionStatus.Processed,
    });
    return row ? wagerTransactionMapper.toDomain(row) : null;
  }

  async findPendingReference(now: Date, limit: number): Promise<WagerTransaction[]> {
    const rows = await this.em.find(
      WagerTransactionOrmEntity,
      {
        status: WagerTransactionStatus.PendingReference,
        $or: [{ nextReferenceCheckAt: null }, { nextReferenceCheckAt: { $lte: now } }],
      },
      { orderBy: { nextReferenceCheckAt: 'asc' }, limit },
    );
    return rows.map((row) => wagerTransactionMapper.toDomain(row));
  }

  async save(transaction: WagerTransaction): Promise<void> {
    await persistOrConflict(async () => {
      const row = wagerTransactionMapper.toPersistence(transaction);
      const existing = await this.em.findOne(WagerTransactionOrmEntity, { id: row.id });

      if (existing) {
        this.em.assign(existing, row);
      } else {
        this.em.persist(this.em.create(WagerTransactionOrmEntity, row));
      }

      await this.em.flush();
    });
  }
}

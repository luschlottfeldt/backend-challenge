import { Injectable } from '@nestjs/common';
import { EntityManager, type FilterQuery } from '@mikro-orm/postgresql';
import type { IWalletLedgerEntryRepository } from '../../../domain/repositories/wallet-ledger-entry.repository.interface.js';
import type { WalletLedgerEntry } from '../../../domain/entities/wallet-ledger-entry.js';
import { WalletLedgerEntryOrmEntity } from '../entities/wallet-ledger-entry.entity.js';
import { walletLedgerEntryMapper } from '../mappers/wallet-ledger-entry.mapper.js';
import { decodeLedgerCursor } from '../../../application/pagination/ledger-cursor.js';
import { persistOrConflict } from '../persist.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@Injectable()
export class WalletLedgerEntryRepository implements IWalletLedgerEntryRepository {
  constructor(private readonly em: EntityManager) {}

  async findByWallet(walletId: string, cursor?: string, limit?: number): Promise<WalletLedgerEntry[]> {
    const take = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const where: FilterQuery<WalletLedgerEntryOrmEntity> = { walletId };

    if (cursor) {
      const decoded = decodeLedgerCursor(cursor);
      where.$or = [
        { createdAt: { $gt: decoded.createdAt } },
        { createdAt: decoded.createdAt, id: { $gt: decoded.id } },
      ];
    }

    const rows = await this.em.find(WalletLedgerEntryOrmEntity, where, {
      orderBy: { createdAt: 'asc', id: 'asc' },
      limit: take,
    });

    return rows.map((row) => walletLedgerEntryMapper.toDomain(row));
  }

  async findByTransactionId(transactionId: string): Promise<WalletLedgerEntry | null> {
    const row = await this.em.findOne(WalletLedgerEntryOrmEntity, { transactionId });
    return row ? walletLedgerEntryMapper.toDomain(row) : null;
  }

  async save(entry: WalletLedgerEntry): Promise<void> {
    await persistOrConflict(async () => {
      this.em.persist(
        this.em.create(WalletLedgerEntryOrmEntity, walletLedgerEntryMapper.toPersistence(entry)),
      );
      await this.em.flush();
    });
  }
}

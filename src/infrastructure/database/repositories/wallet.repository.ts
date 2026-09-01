import { Injectable } from '@nestjs/common';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import type { IWalletRepository } from '../../../domain/repositories/wallet.repository.interface.js';
import type { Wallet } from '../../../domain/entities/wallet.js';
import { WalletOrmEntity } from '../entities/wallet.entity.js';
import { walletMapper } from '../mappers/wallet.mapper.js';

@Injectable()
export class WalletRepository implements IWalletRepository {
  constructor(private readonly em: EntityManager) {}

  async findById(id: string): Promise<Wallet | null> {
    const row = await this.em.findOne(WalletOrmEntity, { id });
    return row ? walletMapper.toDomain(row) : null;
  }

  async findByPlayerAndCurrency(playerId: string, currency: string): Promise<Wallet | null> {
    const row = await this.em.findOne(WalletOrmEntity, { playerId, currency });
    return row ? walletMapper.toDomain(row) : null;
  }

  async findByIdForUpdate(id: string): Promise<Wallet | null> {
    const row = await this.em.findOne(WalletOrmEntity, { id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
    return row ? walletMapper.toDomain(row) : null;
  }

  async save(wallet: Wallet): Promise<void> {
    const row = walletMapper.toPersistence(wallet);
    const existing = await this.em.findOne(WalletOrmEntity, { id: row.id });

    if (existing) {
      this.em.assign(existing, row);
    } else {
      this.em.persist(this.em.create(WalletOrmEntity, row));
    }

    await this.em.flush();
  }
}

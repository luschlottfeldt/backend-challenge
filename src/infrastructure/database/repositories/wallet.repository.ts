import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import type { IWalletRepository } from '../../../domain/repositories/wallet.repository.interface.js';
import type { Wallet } from '../../../domain/entities/wallet.js';

@Injectable()
export class WalletRepository implements IWalletRepository {
  constructor(private readonly em: EntityManager) {}

  async findById(_id: string): Promise<Wallet | null> {
    throw new Error('Not implemented');
  }

  async findByPlayerAndCurrency(_playerId: string, _currency: string): Promise<Wallet | null> {
    throw new Error('Not implemented');
  }

  async findByIdForUpdate(_id: string): Promise<Wallet | null> {
    throw new Error('Not implemented');
  }

  async save(_wallet: Wallet): Promise<void> {
    throw new Error('Not implemented');
  }
}

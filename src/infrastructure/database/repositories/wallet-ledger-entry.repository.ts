import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import type { IWalletLedgerEntryRepository } from '../../../domain/repositories/wallet-ledger-entry.repository.interface.js';
import type { WalletLedgerEntry } from '../../../domain/entities/wallet-ledger-entry.js';

@Injectable()
export class WalletLedgerEntryRepository implements IWalletLedgerEntryRepository {
  constructor(private readonly em: EntityManager) {}

  async findByWallet(
    _walletId: string,
    _cursor?: string,
    _limit?: number,
  ): Promise<WalletLedgerEntry[]> {
    throw new Error('Not implemented');
  }

  async save(_entry: WalletLedgerEntry): Promise<void> {
    throw new Error('Not implemented');
  }
}

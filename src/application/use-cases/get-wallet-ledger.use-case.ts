import { Inject, Injectable } from '@nestjs/common';
import { WalletNotFoundError } from '../../domain/errors/wallet-not-found.error.js';
import type { IWalletRepository } from '../../domain/repositories/wallet.repository.interface.js';
import type { IWalletLedgerEntryRepository } from '../../domain/repositories/wallet-ledger-entry.repository.interface.js';
import { WALLET_REPOSITORY, WALLET_LEDGER_ENTRY_REPOSITORY } from '../../domain/repositories/tokens.js';
import { encodeLedgerCursor } from '../pagination/ledger-cursor.js';
import { toLedgerEntryView, type LedgerEntryView } from './views.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface GetWalletLedgerQuery {
  walletId: string;
  cursor?: string;
  limit?: number;
}

export interface WalletLedgerPage {
  entries: LedgerEntryView[];
  nextCursor: string | null;
}

@Injectable()
export class GetWalletLedgerUseCase {
  constructor(
    @Inject(WALLET_REPOSITORY) private readonly wallets: IWalletRepository,
    @Inject(WALLET_LEDGER_ENTRY_REPOSITORY) private readonly ledger: IWalletLedgerEntryRepository,
  ) {}

  async execute(query: GetWalletLedgerQuery): Promise<WalletLedgerPage> {
    const wallet = await this.wallets.findById(query.walletId);
    if (!wallet) {
      throw new WalletNotFoundError(query.walletId);
    }

    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const entries = await this.ledger.findByWallet(query.walletId, query.cursor, limit);

    const last = entries.at(-1);
    const nextCursor =
      entries.length === limit && last
        ? encodeLedgerCursor({ createdAt: last.createdAt, id: last.id })
        : null;

    return { entries: entries.map(toLedgerEntryView), nextCursor };
  }
}

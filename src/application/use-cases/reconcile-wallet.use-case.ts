import { Inject, Injectable } from '@nestjs/common';
import { Money, type MoneyProps } from '../../domain/entities/money.js';
import { LedgerDirection } from '../../domain/enums/ledger-direction.enum.js';
import { WalletNotFoundError } from '../../domain/errors/wallet-not-found.error.js';
import type { IWalletRepository } from '../../domain/repositories/wallet.repository.interface.js';
import type { IWalletLedgerEntryRepository } from '../../domain/repositories/wallet-ledger-entry.repository.interface.js';
import { WALLET_REPOSITORY, WALLET_LEDGER_ENTRY_REPOSITORY } from '../../domain/repositories/tokens.js';
import { encodeLedgerCursor } from '../pagination/ledger-cursor.js';
import { LOGGER, type Logger } from '../ports/logger.js';
import { METRICS, type Metrics } from '../ports/metrics.js';

const PAGE_SIZE = 200;

export interface ReconcileWalletResult {
  walletId: string;
  storedBalance: MoneyProps;
  calculatedBalance: MoneyProps;
  difference: MoneyProps;
  consistent: boolean;
  checkedEntries: number;
}

@Injectable()
export class ReconcileWalletUseCase {
  constructor(
    @Inject(WALLET_REPOSITORY) private readonly wallets: IWalletRepository,
    @Inject(WALLET_LEDGER_ENTRY_REPOSITORY) private readonly ledger: IWalletLedgerEntryRepository,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  async execute(walletId: string): Promise<ReconcileWalletResult> {
    const wallet = await this.wallets.findById(walletId);
    if (!wallet) {
      throw new WalletNotFoundError(walletId);
    }

    let calculated = Money.zero(wallet.currency);
    let checkedEntries = 0;
    let cursor: string | undefined;

    for (;;) {
      const page = await this.ledger.findByWallet(walletId, cursor, PAGE_SIZE);
      if (page.length === 0) {
        break;
      }

      for (const entry of page) {
        calculated =
          entry.direction === LedgerDirection.Credit
            ? calculated.add(entry.money)
            : calculated.subtract(entry.money);
        checkedEntries += 1;
      }

      if (page.length < PAGE_SIZE) {
        break;
      }
      const last = page[page.length - 1]!;
      cursor = encodeLedgerCursor({ createdAt: last.createdAt, id: last.id });
    }

    const storedBalance = wallet.balance;
    const difference = storedBalance.subtract(calculated);
    const consistent = difference.isZero();

    if (!consistent) {
      this.metrics.reconciliationDivergence();
      this.logger.warn('wallet reconciliation divergence detected', {
        walletId,
        checkedEntries,
        direction: difference.isNegative() ? 'stored-below-ledger' : 'stored-above-ledger',
      });
    }

    return {
      walletId,
      storedBalance: storedBalance.toJSON(),
      calculatedBalance: calculated.toJSON(),
      difference: difference.toJSON(),
      consistent,
      checkedEntries,
    };
  }
}

import { WalletLedgerEntry } from '../../../domain/entities/wallet-ledger-entry.js';
import type { LedgerDirection } from '../../../domain/enums/ledger-direction.enum.js';

export interface WalletLedgerEntryRow {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  amount: string;
  currency: string;
  balanceBeforeAmount: string;
  balanceAfterAmount: string;
  createdAt: Date;
}

export const walletLedgerEntryMapper = {
  toDomain(row: WalletLedgerEntryRow): WalletLedgerEntry {
    return WalletLedgerEntry.rehydrate({
      id: row.id,
      walletId: row.walletId,
      transactionId: row.transactionId,
      direction: row.direction,
      money: { amount: row.amount, currency: row.currency },
      balanceBefore: { amount: row.balanceBeforeAmount, currency: row.currency },
      balanceAfter: { amount: row.balanceAfterAmount, currency: row.currency },
      createdAt: row.createdAt,
    });
  },

  toPersistence(entry: WalletLedgerEntry): WalletLedgerEntryRow {
    return {
      id: entry.id,
      walletId: entry.walletId,
      transactionId: entry.transactionId,
      direction: entry.direction,
      amount: entry.money.toJSON().amount,
      currency: entry.money.currency,
      balanceBeforeAmount: entry.balanceBefore.toJSON().amount,
      balanceAfterAmount: entry.balanceAfter.toJSON().amount,
      createdAt: entry.createdAt,
    };
  },
};

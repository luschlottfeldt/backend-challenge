import type { WalletLedgerEntry } from '../entities/wallet-ledger-entry.js';

export interface IWalletLedgerEntryRepository {
  findByWallet(walletId: string, cursor?: string, limit?: number): Promise<WalletLedgerEntry[]>;
  findByTransactionId(transactionId: string): Promise<WalletLedgerEntry | null>;
  save(entry: WalletLedgerEntry): Promise<void>;
}

import type { Wallet } from '../entities/wallet.js';

export interface IWalletRepository {
  findById(id: string): Promise<Wallet | null>;
  findByPlayerAndCurrency(playerId: string, currency: string): Promise<Wallet | null>;
  findByIdForUpdate(id: string): Promise<Wallet | null>;
  save(wallet: Wallet): Promise<void>;
}

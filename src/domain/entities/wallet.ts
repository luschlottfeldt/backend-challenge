import { Money, type MoneyProps } from './money.js';
import type { WalletLedgerEntry } from './wallet-ledger-entry.js';

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: MoneyProps;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static open(_props: { id: string; playerId: string; initialBalance: Money }): Wallet {
    throw new Error('Not implemented');
  }

  static rehydrate(_state: WalletState): Wallet {
    throw new Error('Not implemented');
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  debit(_money: Money, _transactionId: string): WalletLedgerEntry {
    throw new Error('Not implemented');
  }

  credit(_money: Money, _transactionId: string): WalletLedgerEntry {
    throw new Error('Not implemented');
  }

  private assertSameCurrency(_money: Money): void {
    throw new Error('Not implemented');
  }
}

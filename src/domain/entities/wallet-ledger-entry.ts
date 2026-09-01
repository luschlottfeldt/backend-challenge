import { Money, type MoneyProps } from './money.js';
import type { LedgerDirection } from '../enums/ledger-direction.enum.js';

export interface CreateLedgerEntryProps {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
}

export interface LedgerEntryState {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  createdAt: Date;
}

export class WalletLedgerEntry {
  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    public readonly createdAt: Date,
  ) {}

  static create(_props: CreateLedgerEntryProps): WalletLedgerEntry {
    throw new Error('Not implemented');
  }

  static rehydrate(_state: LedgerEntryState): WalletLedgerEntry {
    throw new Error('Not implemented');
  }

  isBalanced(): boolean {
    throw new Error('Not implemented');
  }
}

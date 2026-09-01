import type { MoneyProps } from '../entities/money.js';
import type { Wallet } from '../entities/wallet.js';
import type { WalletLedgerEntry } from '../entities/wallet-ledger-entry.js';
import type { LedgerDirection } from '../enums/ledger-direction.enum.js';
import { IntegrationEvent } from './integration-event.js';

export interface WalletBalanceChangedData {
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
}

export interface EventContext {
  correlationId: string;
  causationId?: string;
}

export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;

  static from(_wallet: Wallet, _entry: WalletLedgerEntry, _ctx: EventContext): WalletBalanceChanged {
    throw new Error('Not implemented');
  }
}

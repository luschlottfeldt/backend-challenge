import { Money, type MoneyProps } from './money.js';
import { WalletLedgerEntry } from './wallet-ledger-entry.js';
import { LedgerDirection } from '../enums/ledger-direction.enum.js';
import { CurrencyMismatchError } from '../errors/currency-mismatch.error.js';
import { InsufficientFundsError } from '../errors/insufficient-funds.error.js';
import { InvalidLedgerEntryError } from '../errors/invalid-ledger-entry.error.js';

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: MoneyProps;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
  openingTransactionId: string;
  openingLedgerEntryId: string;
  now: Date;
}

export interface WalletMovementContext {
  transactionId: string;
  ledgerEntryId: string;
  occurredAt: Date;
}

export interface OpenedWallet {
  wallet: Wallet;
  openingEntry: WalletLedgerEntry | null;
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

  static open(props: OpenWalletProps): OpenedWallet {
    const currency = props.initialBalance.currency;
    const wallet = new Wallet(
      props.id,
      props.playerId,
      currency,
      props.initialBalance,
      1,
      props.now,
      props.now,
    );

    if (!props.initialBalance.isPositive()) {
      return { wallet, openingEntry: null };
    }

    const openingEntry = WalletLedgerEntry.create({
      id: props.openingLedgerEntryId,
      walletId: wallet.id,
      transactionId: props.openingTransactionId,
      direction: LedgerDirection.Credit,
      money: props.initialBalance,
      balanceBefore: Money.zero(currency),
      balanceAfter: props.initialBalance,
      createdAt: props.now,
    });

    return { wallet, openingEntry };
  }

  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      Money.from(state.balance),
      state.version,
      state.createdAt,
      state.updatedAt,
    );
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

  canDebit(money: Money): boolean {
    this.assertSameCurrency(money);
    return money.isPositive() && !this._balance.subtract(money).isNegative();
  }

  debit(money: Money, ctx: WalletMovementContext): WalletLedgerEntry {
    this.assertSameCurrency(money);
    if (!money.isPositive()) {
      throw new InvalidLedgerEntryError('debit amount must be strictly positive');
    }
    if (!this.canDebit(money)) {
      throw new InsufficientFundsError();
    }
    return this.applyMovement(LedgerDirection.Debit, money, ctx);
  }

  credit(money: Money, ctx: WalletMovementContext): WalletLedgerEntry {
    this.assertSameCurrency(money);
    if (!money.isPositive()) {
      throw new InvalidLedgerEntryError('credit amount must be strictly positive');
    }
    return this.applyMovement(LedgerDirection.Credit, money, ctx);
  }

  private applyMovement(
    direction: LedgerDirection,
    money: Money,
    ctx: WalletMovementContext,
  ): WalletLedgerEntry {
    const balanceBefore = this._balance;
    const balanceAfter =
      direction === LedgerDirection.Debit ? balanceBefore.subtract(money) : balanceBefore.add(money);

    const entry = WalletLedgerEntry.create({
      id: ctx.ledgerEntryId,
      walletId: this.id,
      transactionId: ctx.transactionId,
      direction,
      money,
      balanceBefore,
      balanceAfter,
      createdAt: ctx.occurredAt,
    });

    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = ctx.occurredAt;

    return entry;
  }

  private assertSameCurrency(money: Money): void {
    if (money.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, money.currency);
    }
  }
}

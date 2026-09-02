import { describe, expect, it } from 'bun:test';
import { Wallet } from '../../../../src/domain/entities/wallet.js';
import { Money } from '../../../../src/domain/entities/money.js';
import { LedgerDirection } from '../../../../src/domain/enums/ledger-direction.enum.js';
import { CurrencyMismatchError } from '../../../../src/domain/errors/currency-mismatch.error.js';
import { InsufficientFundsError } from '../../../../src/domain/errors/insufficient-funds.error.js';

const brl = (amount: string): Money => Money.from({ amount, currency: 'BRL' });
const NOW = new Date('2026-09-01T00:00:00.000Z');

const openWith = (amount: string) =>
  Wallet.open({
    id: 'wallet-1',
    playerId: 'player-1',
    initialBalance: brl(amount),
    openingTransactionId: 'opening-tx',
    openingLedgerEntryId: 'opening-entry',
    now: NOW,
  });

const ctx = (over: Partial<{ transactionId: string; ledgerEntryId: string; occurredAt: Date }> = {}) => ({
  transactionId: 'tx-1',
  ledgerEntryId: 'entry-1',
  occurredAt: NOW,
  ...over,
});

describe('Wallet.open', () => {
  it('opens at version 1 with a matching opening CREDIT entry', () => {
    const { wallet, openingEntry } = openWith('1000.00');
    expect(wallet.version).toBe(1);
    expect(wallet.balance.toString()).toBe('1000.00');
    expect(openingEntry?.direction).toBe(LedgerDirection.Credit);
    expect(openingEntry?.balanceBefore.toString()).toBe('0.00');
    expect(openingEntry?.balanceAfter.toString()).toBe('1000.00');
    expect(openingEntry?.isBalanced()).toBe(true);
  });

  it('opens at zero balance without an opening entry', () => {
    const { wallet, openingEntry } = openWith('0.00');
    expect(wallet.version).toBe(1);
    expect(wallet.balance.isZero()).toBe(true);
    expect(openingEntry).toBeNull();
  });
});

describe('Wallet.debit', () => {
  it('debits, bumps version and returns a balanced DEBIT entry', () => {
    const { wallet } = openWith('100.00');
    const entry = wallet.debit(brl('30.00'), ctx());
    expect(wallet.balance.toString()).toBe('70.00');
    expect(wallet.version).toBe(2);
    expect(entry.direction).toBe(LedgerDirection.Debit);
    expect(entry.isBalanced()).toBe(true);
  });

  it('rejects a debit that would overdraw with InsufficientFundsError', () => {
    const { wallet } = openWith('100.00');
    expect(() => wallet.debit(brl('100.01'), ctx())).toThrow(InsufficientFundsError);
    expect(wallet.balance.toString()).toBe('100.00');
    expect(wallet.version).toBe(1);
  });

  it('allows a debit down to exactly zero', () => {
    const { wallet } = openWith('100.00');
    wallet.debit(brl('100.00'), ctx());
    expect(wallet.balance.isZero()).toBe(true);
  });

  it('rejects an operation in a different currency', () => {
    const { wallet } = openWith('100.00');
    expect(() => wallet.debit(Money.from({ amount: '1.00', currency: 'USD' }), ctx())).toThrow(
      CurrencyMismatchError,
    );
  });
});

describe('Wallet.credit', () => {
  it('credits, bumps version and returns a balanced CREDIT entry', () => {
    const { wallet } = openWith('100.00');
    const entry = wallet.credit(brl('25.00'), ctx());
    expect(wallet.balance.toString()).toBe('125.00');
    expect(wallet.version).toBe(2);
    expect(entry.isBalanced()).toBe(true);
  });
});

describe('Wallet sequential movements', () => {
  it('keeps balance and version consistent across a run', () => {
    const { wallet } = openWith('100.00');
    wallet.debit(brl('80.00'), ctx({ ledgerEntryId: 'e1' }));
    wallet.credit(brl('50.00'), ctx({ ledgerEntryId: 'e2' }));
    wallet.debit(brl('20.00'), ctx({ ledgerEntryId: 'e3' }));
    expect(wallet.balance.toString()).toBe('50.00');
    expect(wallet.version).toBe(4);
  });
});

describe('Wallet.rehydrate', () => {
  it('reconstructs persisted state verbatim', () => {
    const wallet = Wallet.rehydrate({
      id: 'wallet-9',
      playerId: 'player-9',
      currency: 'BRL',
      balance: { amount: '42.00', currency: 'BRL' },
      version: 7,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(wallet.balance.toString()).toBe('42.00');
    expect(wallet.version).toBe(7);
  });
});

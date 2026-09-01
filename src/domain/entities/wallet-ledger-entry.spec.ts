import { describe, expect, it } from 'bun:test';
import { WalletLedgerEntry } from './wallet-ledger-entry.js';
import { Money } from './money.js';
import { LedgerDirection } from '../enums/ledger-direction.enum.js';
import { InvalidLedgerEntryError } from '../errors/invalid-ledger-entry.error.js';

const brl = (amount: string): Money => Money.from({ amount, currency: 'BRL' });

const base = {
  id: 'entry-1',
  walletId: 'wallet-1',
  transactionId: 'tx-1',
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
};

describe('WalletLedgerEntry.create', () => {
  it('accepts a balanced debit', () => {
    const entry = WalletLedgerEntry.create({
      ...base,
      direction: LedgerDirection.Debit,
      money: brl('30.00'),
      balanceBefore: brl('100.00'),
      balanceAfter: brl('70.00'),
    });
    expect(entry.isBalanced()).toBe(true);
    expect(entry.direction).toBe(LedgerDirection.Debit);
  });

  it('accepts a balanced credit', () => {
    const entry = WalletLedgerEntry.create({
      ...base,
      direction: LedgerDirection.Credit,
      money: brl('30.00'),
      balanceBefore: brl('100.00'),
      balanceAfter: brl('130.00'),
    });
    expect(entry.isBalanced()).toBe(true);
  });

  it('rejects an arithmetically wrong balanceAfter', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...base,
        direction: LedgerDirection.Debit,
        money: brl('30.00'),
        balanceBefore: brl('100.00'),
        balanceAfter: brl('80.00'),
      }),
    ).toThrow(InvalidLedgerEntryError);
  });

  it('rejects a non-positive amount', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...base,
        direction: LedgerDirection.Credit,
        money: Money.zero('BRL'),
        balanceBefore: brl('100.00'),
        balanceAfter: brl('100.00'),
      }),
    ).toThrow(InvalidLedgerEntryError);

    expect(() =>
      WalletLedgerEntry.create({
        ...base,
        direction: LedgerDirection.Credit,
        money: brl('30.00').negate(),
        balanceBefore: brl('100.00'),
        balanceAfter: brl('70.00'),
      }),
    ).toThrow(InvalidLedgerEntryError);
  });

  it('rejects mismatched currencies', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...base,
        direction: LedgerDirection.Debit,
        money: Money.from({ amount: '30.00', currency: 'USD' }),
        balanceBefore: brl('100.00'),
        balanceAfter: brl('70.00'),
      }),
    ).toThrow(InvalidLedgerEntryError);
  });
});

describe('WalletLedgerEntry.rehydrate', () => {
  it('reconstructs from persisted state without revalidating arithmetic', () => {
    const entry = WalletLedgerEntry.rehydrate({
      ...base,
      direction: LedgerDirection.Debit,
      money: { amount: '30.00', currency: 'BRL' },
      balanceBefore: { amount: '100.00', currency: 'BRL' },
      balanceAfter: { amount: '999.00', currency: 'BRL' },
    });
    expect(entry.balanceAfter.toString()).toBe('999.00');
    expect(entry.isBalanced()).toBe(false);
  });
});

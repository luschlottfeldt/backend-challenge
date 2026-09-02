import { describe, expect, it } from 'bun:test';
import { Money } from '../../../../src/domain/entities/money.js';
import { CurrencyMismatchError } from '../../../../src/domain/errors/currency-mismatch.error.js';
import { InvalidMoneyError } from '../../../../src/domain/errors/invalid-money.error.js';

const brl = (amount: string): Money => Money.from({ amount, currency: 'BRL' });

describe('Money.from', () => {
  it('accepts a well-formed decimal string', () => {
    expect(brl('25.00').toString()).toBe('25.00');
  });

  it('normalizes inputs with fewer than two decimals to fixed scale', () => {
    expect(brl('25').toString()).toBe('25.00');
    expect(brl('25.5').toString()).toBe('25.50');
  });

  it.each([
    ['empty string', ''],
    ['non-numeric', 'abc'],
    ['NaN', 'NaN'],
    ['Infinity', 'Infinity'],
    ['scientific notation', '1e5'],
    ['leading plus', '+1.00'],
    ['trailing dot', '25.'],
    ['whitespace', ' 1.00 '],
    ['more than two decimals', '1.234'],
    ['negative amount', '-5.00'],
  ])('rejects %s', (_label, amount) => {
    expect(() => brl(amount)).toThrow(InvalidMoneyError);
  });

  it.each([['lowercase', 'brl'], ['two letters', 'BR'], ['four letters', 'BRLX'], ['digits', 'BR1']])(
    'rejects currency %s',
    (_label, currency) => {
      expect(() => Money.from({ amount: '1.00', currency })).toThrow(InvalidMoneyError);
    },
  );
});

describe('Money arithmetic', () => {
  it('adds without floating point drift', () => {
    expect(brl('0.10').add(brl('0.20')).toString()).toBe('0.30');
  });

  it('subtracts', () => {
    expect(brl('100.00').subtract(brl('80.00')).toString()).toBe('20.00');
  });

  it('negates', () => {
    expect(brl('25.00').negate().toString()).toBe('-25.00');
    expect(brl('25.00').negate().isNegative()).toBe(true);
  });

  it('is immutable', () => {
    const original = brl('10.00');
    original.add(brl('5.00'));
    expect(original.toString()).toBe('10.00');
  });
});

describe('Money predicates', () => {
  it('reports zero / positive / negative', () => {
    expect(Money.zero('BRL').isZero()).toBe(true);
    expect(brl('1.00').isPositive()).toBe(true);
    expect(brl('1.00').isNegative()).toBe(false);
    expect(brl('1.00').negate().isNegative()).toBe(true);
  });

  it('compares with isLessThan', () => {
    expect(brl('19.99').isLessThan(brl('20.00'))).toBe(true);
    expect(brl('20.00').isLessThan(brl('20.00'))).toBe(false);
  });

  it('equals only for same currency and amount', () => {
    expect(brl('5.00').equals(brl('5.00'))).toBe(true);
    expect(brl('5.00').equals(brl('5.01'))).toBe(false);
    expect(brl('5.00').equals(Money.from({ amount: '5.00', currency: 'USD' }))).toBe(false);
  });
});

describe('Money currency safety', () => {
  const usd = Money.from({ amount: '1.00', currency: 'USD' });

  it('throws CurrencyMismatchError on cross-currency add', () => {
    expect(() => brl('1.00').add(usd)).toThrow(CurrencyMismatchError);
  });

  it('throws CurrencyMismatchError on cross-currency subtract', () => {
    expect(() => brl('1.00').subtract(usd)).toThrow(CurrencyMismatchError);
  });

  it('throws CurrencyMismatchError on cross-currency isLessThan', () => {
    expect(() => brl('1.00').isLessThan(usd)).toThrow(CurrencyMismatchError);
  });
});

describe('Money serialization', () => {
  it('round-trips through toJSON', () => {
    const json = brl('25.00').toJSON();
    expect(json).toEqual({ amount: '25.00', currency: 'BRL' });
    expect(Money.from(json).equals(brl('25.00'))).toBe(true);
  });
});

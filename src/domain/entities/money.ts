import { Decimal } from 'decimal.js';
import { CurrencyMismatchError } from '../errors/currency-mismatch.error.js';
import { InvalidMoneyError } from '../errors/invalid-money.error.js';

export interface MoneyProps {
  amount: string;
  currency: string;
}

const SCALE = 2;
const AMOUNT_PATTERN = /^-?\d+(\.\d+)?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  static from(props: MoneyProps): Money {
    const currency = Money.assertCurrency(props.currency);
    const value = Money.parseAmount(props.amount, false);
    return new Money(value, currency);
  }

  static zero(currency: string): Money {
    return new Money(new Decimal(0).toDecimalPlaces(SCALE), Money.assertCurrency(currency));
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.value.minus(other.value), this.currency);
  }

  negate(): Money {
    return Money.of(this.value.negated(), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.greaterThan(0);
  }

  isNegative(): boolean {
    return this.value.lessThan(0);
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value);
  }

  toJSON(): MoneyProps {
    return { amount: this.toString(), currency: this.currency };
  }

  toString(): string {
    return this.value.toFixed(SCALE);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }

  private static of(value: Decimal, currency: string): Money {
    return new Money(value.toDecimalPlaces(SCALE), currency);
  }

  private static parseAmount(raw: string, allowNegative: boolean): Decimal {
    if (typeof raw !== 'string' || !AMOUNT_PATTERN.test(raw)) {
      throw new InvalidMoneyError(raw);
    }

    const fractional = raw.split('.')[1];
    if (fractional !== undefined && fractional.length > SCALE) {
      throw new InvalidMoneyError(raw);
    }

    const value = new Decimal(raw);
    if (!value.isFinite()) {
      throw new InvalidMoneyError(raw);
    }
    if (!allowNegative && value.isNegative() && !value.isZero()) {
      throw new InvalidMoneyError(raw);
    }

    return value.toDecimalPlaces(SCALE);
  }

  private static assertCurrency(currency: string): string {
    if (typeof currency !== 'string' || !CURRENCY_PATTERN.test(currency)) {
      throw new InvalidMoneyError(currency);
    }
    return currency;
  }
}

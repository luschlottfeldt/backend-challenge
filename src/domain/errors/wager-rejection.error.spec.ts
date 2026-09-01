import { describe, expect, it } from 'bun:test';
import { FailureCode, isFailureCode } from '../enums/failure-code.js';
import { DomainError } from './domain-error.js';
import { WagerRejectionError } from './wager-rejection.error.js';
import { WagerFailureError } from './wager-failure.error.js';
import { CurrencyMismatchError } from './currency-mismatch.error.js';
import { InsufficientFundsError } from './insufficient-funds.error.js';
import { ReversalWouldOverdrawError } from './reversal-would-overdraw.error.js';
import { IdempotencyConflictError } from './idempotency-conflict.error.js';
import { ReferenceResolutionError } from './reference-resolution.error.js';
import { PermanentInfrastructureError } from './permanent-infrastructure.error.js';

describe('FailureCode taxonomy', () => {
  it('every code is a stable UPPER_SNAKE string equal to nothing else', () => {
    const values = Object.values(FailureCode);
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) {
      expect(value).toMatch(/^[A-Z]+(_[A-Z]+)*$/);
    }
  });

  it('isFailureCode narrows known codes only', () => {
    expect(isFailureCode('INSUFFICIENT_FUNDS')).toBe(true);
    expect(isFailureCode('nope')).toBe(false);
  });
});

describe('rejection errors', () => {
  const cases: Array<[WagerRejectionError, FailureCode]> = [
    [new CurrencyMismatchError('BRL', 'USD'), FailureCode.CurrencyMismatch],
    [new InsufficientFundsError(), FailureCode.InsufficientFunds],
    [new ReversalWouldOverdrawError(), FailureCode.ReversalWouldOverdraw],
    [new IdempotencyConflictError('provider-a:tx-1'), FailureCode.IdempotencyConflict],
    [ReferenceResolutionError.required(), FailureCode.ReferenceRequired],
    [ReferenceResolutionError.notFound(), FailureCode.ReferenceNotFound],
    [ReferenceResolutionError.notProcessed(), FailureCode.ReferenceNotProcessed],
    [ReferenceResolutionError.kindNotAllowed(), FailureCode.ReferenceKindNotAllowed],
    [ReferenceResolutionError.contextMismatch(), FailureCode.ReferenceContextMismatch],
    [ReferenceResolutionError.alreadyReversed(), FailureCode.ReferenceAlreadyReversed],
    [ReferenceResolutionError.amountMismatch(), FailureCode.AmountMismatch],
  ];

  it.each(cases)('%o carries its failure code and is a DomainError', (error, code) => {
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toBeInstanceOf(WagerRejectionError);
    expect(error.code).toBe(code);
    expect(isFailureCode(error.code)).toBe(true);
    expect(error.message.length).toBeGreaterThan(0);
    expect(error.name).toBe(error.constructor.name);
  });

  it('distinguishes an insufficient bet from an overdrawing reversal', () => {
    expect(new InsufficientFundsError().code).not.toBe(new ReversalWouldOverdrawError().code);
  });
});

describe('failure errors', () => {
  it('permanent infrastructure error is a WagerFailureError, not a rejection', () => {
    const error = new PermanentInfrastructureError();
    expect(error).toBeInstanceOf(WagerFailureError);
    expect(error).not.toBeInstanceOf(WagerRejectionError);
    expect(error.code).toBe(FailureCode.PermanentInfrastructureError);
  });
});

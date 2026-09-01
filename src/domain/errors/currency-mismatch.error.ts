import { FailureCode } from '../enums/failure-code.js';
import { WagerRejectionError } from './wager-rejection.error.js';

export class CurrencyMismatchError extends WagerRejectionError {
  readonly code = FailureCode.CurrencyMismatch;

  constructor(
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(`Expected currency ${expected}, received ${actual}`);
  }
}

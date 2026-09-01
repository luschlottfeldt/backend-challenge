import { FailureCode } from '../enums/failure-code.js';
import { WagerRejectionError } from './wager-rejection.error.js';

export class InsufficientFundsError extends WagerRejectionError {
  readonly code = FailureCode.InsufficientFunds;

  constructor() {
    super('Wallet balance is insufficient for the requested debit');
  }
}

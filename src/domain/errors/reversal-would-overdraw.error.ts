import { FailureCode } from '../enums/failure-code.js';
import { WagerRejectionError } from './wager-rejection.error.js';

export class ReversalWouldOverdrawError extends WagerRejectionError {
  readonly code = FailureCode.ReversalWouldOverdraw;

  constructor() {
    super('Reversal would drive the wallet balance negative');
  }
}

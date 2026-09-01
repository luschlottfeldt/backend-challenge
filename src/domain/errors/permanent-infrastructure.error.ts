import { FailureCode } from '../enums/failure-code.js';
import { WagerFailureError } from './wager-failure.error.js';

export class PermanentInfrastructureError extends WagerFailureError {
  readonly code = FailureCode.PermanentInfrastructureError;

  constructor(message = 'A permanent infrastructure error prevented the transaction from being applied') {
    super(message);
  }
}

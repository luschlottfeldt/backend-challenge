import { FailureCode } from '../enums/failure-code.js';
import { WagerRejectionError } from './wager-rejection.error.js';

export class IdempotencyConflictError extends WagerRejectionError {
  readonly code = FailureCode.IdempotencyConflict;

  constructor(public readonly idempotencyKey: string) {
    super(`Idempotency key ${idempotencyKey} was already used with a different payload`);
  }
}

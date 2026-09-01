import { DomainError } from './domain-error.js';
import type { WagerTransactionStatus } from '../enums/wager-transaction-status.enum.js';

export class InvalidTransactionStateError extends DomainError {
  readonly code = 'INVALID_TRANSACTION_STATE';

  constructor(
    public readonly currentStatus: WagerTransactionStatus,
    public readonly attemptedStatus: WagerTransactionStatus,
  ) {
    super(`Cannot transition WagerTransaction from ${currentStatus} to ${attemptedStatus}`);
  }
}

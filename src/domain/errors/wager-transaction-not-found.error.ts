import { DomainError } from './domain-error.js';

export class WagerTransactionNotFoundError extends DomainError {
  readonly code = 'WAGER_TRANSACTION_NOT_FOUND';

  constructor(public readonly reference: string) {
    super(`Wager transaction ${reference} was not found`);
  }
}

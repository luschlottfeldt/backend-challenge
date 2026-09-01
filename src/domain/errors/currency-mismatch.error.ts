import { DomainError } from './domain-error.js';

export class CurrencyMismatchError extends DomainError {
  readonly code = 'CURRENCY_MISMATCH';

  constructor(
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(`Expected currency ${expected}, received ${actual}`);
  }
}

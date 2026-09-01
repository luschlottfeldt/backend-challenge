import { DomainError } from './domain-error.js';

export class InvalidMoneyError extends DomainError {
  readonly code = 'INVALID_MONEY';

  constructor(public readonly value: unknown) {
    super(`Invalid monetary value: ${JSON.stringify(value)}`);
  }
}

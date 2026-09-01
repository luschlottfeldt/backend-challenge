import { DomainError } from './domain-error.js';

export class InvalidLedgerCursorError extends DomainError {
  readonly code = 'INVALID_LEDGER_CURSOR';

  constructor() {
    super('The provided ledger cursor is not a valid opaque cursor');
  }
}

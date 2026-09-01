import { DomainError } from './domain-error.js';

export class PersistenceConflictError extends DomainError {
  readonly code = 'PERSISTENCE_CONFLICT';

  constructor(public readonly constraint: string) {
    super(`A concurrent write violated the ${constraint} constraint`);
  }
}

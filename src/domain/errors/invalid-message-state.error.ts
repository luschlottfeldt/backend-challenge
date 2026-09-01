import { DomainError } from './domain-error.js';

export class InvalidMessageStateError extends DomainError {
  readonly code = 'INVALID_MESSAGE_STATE';

  constructor(reason: string) {
    super(`Invalid message state: ${reason}`);
  }
}

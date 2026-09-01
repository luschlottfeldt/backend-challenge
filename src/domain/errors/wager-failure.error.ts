import { DomainError } from './domain-error.js';
import type { FailureCode } from '../enums/failure-code.js';

export abstract class WagerFailureError extends DomainError {
  abstract override readonly code: FailureCode;
}

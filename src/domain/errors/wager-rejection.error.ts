import { DomainError } from './domain-error.js';
import type { FailureCode } from '../enums/failure-code.js';

export abstract class WagerRejectionError extends DomainError {
  abstract override readonly code: FailureCode;
}

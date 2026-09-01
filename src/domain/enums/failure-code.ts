export const FailureCode = {
  InsufficientFunds: 'INSUFFICIENT_FUNDS',
  ReversalWouldOverdraw: 'REVERSAL_WOULD_OVERDRAW',
  CurrencyMismatch: 'CURRENCY_MISMATCH',
  IdempotencyConflict: 'IDEMPOTENCY_CONFLICT',
  ReferenceRequired: 'REFERENCE_REQUIRED',
  ReferenceNotFound: 'REFERENCE_NOT_FOUND',
  ReferenceNotProcessed: 'REFERENCE_NOT_PROCESSED',
  ReferenceKindNotAllowed: 'REFERENCE_KIND_NOT_ALLOWED',
  ReferenceContextMismatch: 'REFERENCE_CONTEXT_MISMATCH',
  ReferenceAlreadyReversed: 'REFERENCE_ALREADY_REVERSED',
  AmountMismatch: 'AMOUNT_MISMATCH',
  PermanentInfrastructureError: 'PERMANENT_INFRASTRUCTURE_ERROR',
} as const;

export type FailureCode = (typeof FailureCode)[keyof typeof FailureCode];

const KNOWN_FAILURE_CODES = new Set<string>(Object.values(FailureCode));

export function isFailureCode(value: string): value is FailureCode {
  return KNOWN_FAILURE_CODES.has(value);
}

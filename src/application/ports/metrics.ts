export type DuplicateSource = 'idempotency-key' | 'inbox';
export type RetryKind = 'outbox' | 'reference';

export interface Metrics {
  transactionSettled(status: string, kind: string): void;
  duplicateDetected(source: DuplicateSource): void;
  retryScheduled(kind: RetryKind): void;
  messageDeadLettered(reason: string): void;
  lockConflict(): void;
  reconciliationDivergence(): void;
  observeProcessingLatency(seconds: number, outcome: string): void;
  setOutboxLagSeconds(seconds: number): void;
}

export const METRICS = Symbol('Metrics');

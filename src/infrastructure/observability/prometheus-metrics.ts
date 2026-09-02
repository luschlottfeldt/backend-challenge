import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import type {
  DuplicateSource,
  Metrics,
  RetryKind,
} from '../../application/ports/metrics.js';

@Injectable()
export class PrometheusMetrics implements Metrics {
  readonly registry = new Registry();

  private readonly transactions = new Counter({
    name: 'wager_transactions_settled_total',
    help: 'Wager transactions that reached a settled status',
    labelNames: ['status', 'kind'],
    registers: [this.registry],
  });

  private readonly duplicates = new Counter({
    name: 'wager_duplicates_detected_total',
    help: 'Duplicate submissions detected, by deduplication layer',
    labelNames: ['source'],
    registers: [this.registry],
  });

  private readonly retries = new Counter({
    name: 'wager_retries_scheduled_total',
    help: 'Retries scheduled with backoff',
    labelNames: ['kind'],
    registers: [this.registry],
  });

  private readonly deadLetters = new Counter({
    name: 'wager_messages_dead_lettered_total',
    help: 'Messages routed to the dead-letter queue',
    labelNames: ['reason'],
    registers: [this.registry],
  });

  private readonly lockConflicts = new Counter({
    name: 'wager_lock_conflicts_total',
    help: 'Concurrency conflicts on the wallet unit of concurrency',
    registers: [this.registry],
  });

  private readonly processingLatency = new Histogram({
    name: 'wager_processing_latency_seconds',
    help: 'End-to-end latency of processing a wager transaction',
    labelNames: ['outcome'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  private readonly outboxLag = new Gauge({
    name: 'wager_outbox_lag_seconds',
    help: 'Age of the oldest unpublished outbox message',
    registers: [this.registry],
  });

  private readonly reconciliationDivergences = new Counter({
    name: 'wager_reconciliation_divergences_total',
    help: 'Wallet reconciliations where stored and calculated balances disagreed',
    registers: [this.registry],
  });

  transactionSettled(status: string, kind: string): void {
    this.transactions.inc({ status, kind });
  }

  duplicateDetected(source: DuplicateSource): void {
    this.duplicates.inc({ source });
  }

  retryScheduled(kind: RetryKind): void {
    this.retries.inc({ kind });
  }

  messageDeadLettered(reason: string): void {
    this.deadLetters.inc({ reason });
  }

  lockConflict(): void {
    this.lockConflicts.inc();
  }

  reconciliationDivergence(): void {
    this.reconciliationDivergences.inc();
  }

  observeProcessingLatency(seconds: number, outcome: string): void {
    this.processingLatency.observe({ outcome }, seconds);
  }

  setOutboxLagSeconds(seconds: number): void {
    this.outboxLag.set(seconds);
  }

  collect(): Promise<string> {
    return this.registry.metrics();
  }
}

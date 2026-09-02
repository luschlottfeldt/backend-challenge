import { describe, expect, it } from 'bun:test';
import { PrometheusMetrics } from '../../../../src/infrastructure/observability/prometheus-metrics.js';

describe('PrometheusMetrics', () => {
  it('exposes every mandatory metric in the Prometheus text format', async () => {
    const metrics = new PrometheusMetrics();

    metrics.transactionSettled('PROCESSED', 'BET');
    metrics.transactionSettled('REJECTED', 'BET');
    metrics.duplicateDetected('idempotency-key');
    metrics.duplicateDetected('inbox');
    metrics.retryScheduled('outbox');
    metrics.retryScheduled('reference');
    metrics.messageDeadLettered('MalformedMessageError');
    metrics.lockConflict();
    metrics.lockConflict();
    metrics.observeProcessingLatency(0.042, 'PROCESSED');
    metrics.setOutboxLagSeconds(3.5);

    const text = await metrics.collect();

    expect(text).toContain('wager_transactions_settled_total{status="PROCESSED",kind="BET"} 1');
    expect(text).toContain('wager_transactions_settled_total{status="REJECTED",kind="BET"} 1');
    expect(text).toContain('wager_duplicates_detected_total{source="idempotency-key"} 1');
    expect(text).toContain('wager_duplicates_detected_total{source="inbox"} 1');
    expect(text).toContain('wager_retries_scheduled_total{kind="outbox"} 1');
    expect(text).toContain('wager_retries_scheduled_total{kind="reference"} 1');
    expect(text).toContain(
      'wager_messages_dead_lettered_total{reason="MalformedMessageError"} 1',
    );
    expect(text).toContain('wager_lock_conflicts_total 2');
    expect(text).toContain('wager_processing_latency_seconds_count{outcome="PROCESSED"} 1');
    expect(text).toContain('wager_outbox_lag_seconds 3.5');
  });

  it('keeps counters isolated per instance', async () => {
    const a = new PrometheusMetrics();
    const b = new PrometheusMetrics();
    a.lockConflict();

    expect(await a.collect()).toContain('wager_lock_conflicts_total 1');
    expect(await b.collect()).toContain('wager_lock_conflicts_total 0');
  });
});

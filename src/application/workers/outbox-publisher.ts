import { Inject, Injectable } from '@nestjs/common';
import type { IOutboxMessageRepository } from '../../domain/repositories/outbox-message.repository.interface.js';
import { OUTBOX_MESSAGE_REPOSITORY } from '../../domain/repositories/tokens.js';
import { TRANSACTION_RUNNER, type TransactionRunner } from '../ports/transaction-runner.js';
import { CLOCK, type Clock } from '../ports/clock.js';
import { LOGGER, type Logger } from '../ports/logger.js';
import { MESSAGE_PUBLISHER, type MessagePublisher } from '../ports/message-publisher.js';
import { METRICS, type Metrics } from '../ports/metrics.js';

const DEFAULT_BATCH_SIZE = 10;

export interface OutboxPublishTick {
  claimed: number;
  published: number;
  retried: number;
}

@Injectable()
export class OutboxPublisher {
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly runner: TransactionRunner,
    @Inject(OUTBOX_MESSAGE_REPOSITORY) private readonly outbox: IOutboxMessageRepository,
    @Inject(MESSAGE_PUBLISHER) private readonly publisher: MessagePublisher,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  runOnce(batchSize = DEFAULT_BATCH_SIZE): Promise<OutboxPublishTick> {
    return this.runner.run(async () => {
      const now = this.clock.now();
      const due = await this.outbox.findDue(now, batchSize);
      const tick: OutboxPublishTick = { claimed: due.length, published: 0, retried: 0 };

      for (const message of due) {
        try {
          await this.publisher.publish({
            id: message.id,
            type: message.eventType,
            body: JSON.stringify(message.payload),
            groupId: message.aggregateId,
            deduplicationId: message.id,
          });
          message.markPublished(now);
          tick.published += 1;
        } catch (error) {
          message.scheduleRetry(now);
          tick.retried += 1;
          this.metrics.retryScheduled('outbox');
          this.logger.warn('outbox publish failed; retry scheduled', {
            outboxMessageId: message.id,
            eventType: message.eventType,
            attempts: message.attempts,
            error: (error as Error).message,
          });
        }
        await this.outbox.save(message);
      }

      const oldest = await this.outbox.oldestUnpublishedAt();
      this.metrics.setOutboxLagSeconds(
        oldest ? Math.max(0, (now.getTime() - oldest.getTime()) / 1000) : 0,
      );

      return tick;
    });
  }
}

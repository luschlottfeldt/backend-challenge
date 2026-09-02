import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type Message,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { DomainError } from '../../domain/errors/domain-error.js';
import { MalformedMessageError } from '../../application/messaging/malformed-message.error.js';
import { InboundWagerTransactionHandler } from '../../application/messaging/inbound-wager-transaction.handler.js';
import { randomUUID } from 'node:crypto';
import { LOGGER, type Logger } from '../../application/ports/logger.js';
import { METRICS, type Metrics } from '../../application/ports/metrics.js';
import {
  LOG_CONTEXT_STORE,
  type LogContextStore,
} from '../../application/ports/log-context.js';
import { SQS_CLIENT } from './sqs-client.provider.js';

@Injectable()
export class SqsWagerTransactionConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly queueUrl = process.env.SQS_WAGER_TRANSACTIONS_QUEUE_URL ?? '';
  private readonly dlqUrl = process.env.SQS_WAGER_TRANSACTIONS_DLQ_URL ?? '';
  private stopping = false;
  private loop?: Promise<void>;

  constructor(
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
    private readonly handler: InboundWagerTransactionHandler,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(LOG_CONTEXT_STORE) private readonly logContext: LogContextStore,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.SQS_CONSUMER_ENABLED === 'false') {
      return;
    }
    this.loop = this.run();
    this.logger.info('sqs consumer started', { queueUrl: this.queueUrl });
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await this.loop;
  }

  private async run(): Promise<void> {
    while (!this.stopping) {
      try {
        await this.pollOnce();
      } catch (error) {
        this.logger.error('sqs receive failed', { error: (error as Error).message });
        await this.pause();
      }
    }
  }

  async pollOnce(): Promise<number> {
    const response = await this.sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: Number(process.env.SQS_CONSUMER_BATCH_SIZE ?? 10),
        WaitTimeSeconds: Number(process.env.SQS_CONSUMER_WAIT_SECONDS ?? 5),
        MessageAttributeNames: ['All'],
        MessageSystemAttributeNames: ['MessageGroupId'],
      }),
    );
    const messages = response.Messages ?? [];

    let handled = 0;
    for (const message of messages) {
      if (this.stopping) {
        break;
      }
      await this.consume(message);
      handled += 1;
    }
    return handled;
  }

  private consume(message: Message): Promise<void> {
    return this.logContext.run(
      { correlationId: randomUUID(), messageId: message.MessageId },
      () => this.handleMessage(message),
    );
  }

  private async handleMessage(message: Message): Promise<void> {
    const body = message.Body ?? '';
    try {
      const outcome = await this.handler.handle(body);
      if (outcome.status === 'duplicate') {
        this.metrics.duplicateDetected('inbox');
      }
      await this.deleteMessage(message);
      this.logger.info('sqs message handled', {
        messageId: outcome.messageId,
        status: outcome.status,
        sqsMessageId: message.MessageId,
      });
    } catch (error) {
      if (error instanceof MalformedMessageError || error instanceof DomainError) {
        await this.deadLetter(message, error);
        return;
      }
      this.logger.warn('sqs message failed; leaving for redelivery', {
        sqsMessageId: message.MessageId,
        error: (error as Error).message,
      });
    }
  }

  private async deadLetter(message: Message, error: Error): Promise<void> {
    if (this.dlqUrl) {
      await this.sqs.send(
        new SendMessageCommand({
          QueueUrl: this.dlqUrl,
          MessageBody: message.Body ?? '',
          MessageGroupId: message.Attributes?.MessageGroupId ?? 'dead-letter',
          MessageDeduplicationId: message.MessageId ?? crypto.randomUUID(),
          MessageAttributes: {
            deadLetterReason: { DataType: 'String', StringValue: error.name },
            deadLetterMessage: { DataType: 'String', StringValue: error.message.slice(0, 256) },
          },
        }),
      );
    }
    await this.deleteMessage(message);
    this.metrics.messageDeadLettered(error.name);
    this.logger.error('sqs message dead-lettered', {
      sqsMessageId: message.MessageId,
      reason: error.name,
      error: error.message,
    });
  }

  private async deleteMessage(message: Message): Promise<void> {
    await this.sqs.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: message.ReceiptHandle!,
      }),
    );
  }

  private pause(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

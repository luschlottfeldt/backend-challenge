import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { MikroORM } from '@mikro-orm/postgresql';
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { createTestOrm, truncateAll } from './orm-fixture.js';
import { MutableClock } from './wire-use-cases.js';
import { MikroOrmTransactionRunner } from '../../src/infrastructure/database/mikro-orm-transaction-runner.js';
import { OutboxMessageRepository } from '../../src/infrastructure/database/repositories/outbox-message.repository.js';
import { SqsMessagePublisher } from '../../src/infrastructure/messaging/sqs-message-publisher.js';
import { OutboxPublisher } from '../../src/application/workers/outbox-publisher.js';
import { OutboxMessage } from '../../src/domain/entities/outbox-message.js';
import {
  IntegrationEvent,
  type IntegrationEventProps,
} from '../../src/domain/events/integration-event.js';
import type { MessagePublisher } from '../../src/application/ports/message-publisher.js';

const QUEUE_URL =
  process.env.SQS_INTEGRATION_EVENTS_QUEUE_URL ??
  'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/integration-events.fifo';

class TestEvent extends IntegrationEvent<{ value: number }> {
  readonly eventType = 'TestEvent';
  readonly version = 1;

  constructor(props: IntegrationEventProps<{ value: number }>) {
    super(props);
  }
}

const noopLogger = { info() {}, warn() {}, error() {} };

let orm: MikroORM;
let sqs: SQSClient;
let clock: MutableClock;
let outbox: OutboxMessageRepository;
let runner: MikroOrmTransactionRunner;

const BASE = new Date('2026-09-01T00:00:00.000Z');

const message = (over: Partial<{ value: number; aggregateId: string }> = {}): OutboxMessage => {
  const eventId = crypto.randomUUID();
  return OutboxMessage.enqueue(
    new TestEvent({
      eventId,
      aggregateId: over.aggregateId ?? crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      occurredAt: clock.now(),
      data: { value: over.value ?? 1 },
    }),
  );
};

const drainQueue = async (): Promise<Record<string, unknown>[]> => {
  const received: Record<string, unknown>[] = [];
  for (;;) {
    const res = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: QUEUE_URL,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
        MessageAttributeNames: ['All'],
      }),
    );
    if (!res.Messages || res.Messages.length === 0) {
      break;
    }
    for (const msg of res.Messages) {
      received.push(JSON.parse(msg.Body ?? '{}'));
      await sqs.send(
        new DeleteMessageCommand({ QueueUrl: QUEUE_URL, ReceiptHandle: msg.ReceiptHandle! }),
      );
    }
  }
  return received;
};

const publisherFor = (client: SQSClient): MessagePublisher =>
  new SqsMessagePublisher(client, QUEUE_URL);

const buildWorker = (publisher: MessagePublisher) =>
  new OutboxPublisher(runner, outbox, publisher, clock, noopLogger);

beforeAll(async () => {
  orm = await createTestOrm();
  sqs = new SQSClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: process.env.AWS_SQS_ENDPOINT ?? 'http://localhost:4566',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
});

afterAll(async () => {
  await orm.close();
  sqs.destroy();
});

beforeEach(async () => {
  await truncateAll(orm);
  await drainQueue();
  clock = new MutableClock(new Date(BASE));
  runner = new MikroOrmTransactionRunner(orm.em);
  outbox = new OutboxMessageRepository(orm.em);
});

describe('OutboxPublisher', () => {
  it('publishes due messages to SQS and marks them published', async () => {
    const a = message({ value: 10 });
    const b = message({ value: 20 });
    await outbox.save(a);
    await outbox.save(b);

    const tick = await buildWorker(publisherFor(sqs)).runOnce();
    expect(tick).toEqual({ claimed: 2, published: 2, retried: 0 });

    const stored = await runner.run(() => outbox.findDue(new Date(BASE), 10));
    expect(stored).toHaveLength(0);

    const delivered = await drainQueue();
    const values = delivered.map((d) => (d.data as { value: number }).value).sort();
    expect(values).toEqual([10, 20]);
  });

  it('reschedules with backoff when publishing fails', async () => {
    const failing: MessagePublisher = {
      publish: () => Promise.reject(new Error('sqs down')),
    };
    await outbox.save(message());

    const tick = await buildWorker(failing).runOnce();
    expect(tick).toEqual({ claimed: 1, published: 0, retried: 1 });

    const dueNow = await runner.run(() => outbox.findDue(new Date(BASE), 10));
    expect(dueNow).toHaveLength(0);

    const dueLater = await runner.run(() =>
      outbox.findDue(new Date(BASE.getTime() + 60_000), 10),
    );
    expect(dueLater).toHaveLength(1);
    expect(dueLater[0]!.attempts).toBe(1);
  });

  it('two concurrent publishers each claim disjoint rows, no message lost or duplicated', async () => {
    for (let i = 0; i < 6; i += 1) {
      await outbox.save(message({ value: i }));
    }

    const workerA = new OutboxPublisher(
      new MikroOrmTransactionRunner(orm.em),
      new OutboxMessageRepository(orm.em),
      publisherFor(sqs),
      clock,
      noopLogger,
    );
    const workerB = new OutboxPublisher(
      new MikroOrmTransactionRunner(orm.em),
      new OutboxMessageRepository(orm.em),
      publisherFor(sqs),
      clock,
      noopLogger,
    );

    const [tickA, tickB] = await Promise.all([workerA.runOnce(), workerB.runOnce()]);
    expect(tickA.published + tickB.published).toBe(6);

    const remaining = await runner.run(() => outbox.findDue(new Date(BASE), 20));
    expect(remaining).toHaveLength(0);

    const delivered = await drainQueue();
    expect(delivered.map((d) => (d.data as { value: number }).value).sort()).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
  });

  it('a message already published is not sent again', async () => {
    const m = message({ value: 99 });
    await outbox.save(m);
    await buildWorker(publisherFor(sqs)).runOnce();
    await drainQueue();

    const tick = await buildWorker(publisherFor(sqs)).runOnce();
    expect(tick.claimed).toBe(0);
    expect(await drainQueue()).toHaveLength(0);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { RequestContext } from '@mikro-orm/core';
import type { MikroORM } from '@mikro-orm/postgresql';
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { createTestOrm, truncateAll } from '../integration/orm-fixture.js';
import {
  MutableClock,
  noopLogContext,
  noopMetrics,
  wireUseCases,
} from '../integration/wire-use-cases.js';
import { MikroOrmTransactionRunner } from '../../src/infrastructure/database/mikro-orm-transaction-runner.js';
import { InboxMessageRepository } from '../../src/infrastructure/database/repositories/inbox-message.repository.js';
import { OutboxMessageRepository } from '../../src/infrastructure/database/repositories/outbox-message.repository.js';
import { SqsMessagePublisher } from '../../src/infrastructure/messaging/sqs-message-publisher.js';
import { SqsWagerTransactionConsumer } from '../../src/infrastructure/messaging/sqs-wager-transaction-consumer.js';
import { InboundWagerTransactionHandler } from '../../src/application/messaging/inbound-wager-transaction.handler.js';
import { OutboxPublisher } from '../../src/application/workers/outbox-publisher.js';
import { OutboxMessage } from '../../src/domain/entities/outbox-message.js';
import {
  IntegrationEvent,
  type IntegrationEventProps,
} from '../../src/domain/events/integration-event.js';

const QUEUE_URL =
  process.env.SQS_WAGER_TRANSACTIONS_QUEUE_URL ??
  'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/wager-transactions.fifo';
const EVENTS_QUEUE_URL =
  process.env.SQS_INTEGRATION_EVENTS_QUEUE_URL ??
  'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/integration-events.fifo';

const noopLogger = { info() {}, warn() {}, error() {} };
const BASE = new Date('2026-09-01T00:00:00.000Z');
const brl = (amount: string) => ({ amount, currency: 'BRL' });

let orm: MikroORM;
let sqs: SQSClient;
let clock: MutableClock;
let uc: ReturnType<typeof wireUseCases>;

const inContext = <T>(work: () => Promise<T>): Promise<T> => RequestContext.create(orm.em, work);

beforeAll(async () => {
  process.env.SQS_CONSUMER_WAIT_SECONDS = '1';
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
  await drain(QUEUE_URL);
  await drain(EVENTS_QUEUE_URL);
  clock = new MutableClock(new Date(BASE));
  uc = wireUseCases(orm, clock);
}, 30000);

const drain = async (queueUrl: string): Promise<string[]> => {
  const bodies: string[] = [];
  for (;;) {
    const res = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
        VisibilityTimeout: 2,
      }),
    );
    if (!res.Messages?.length) break;
    for (const m of res.Messages) {
      bodies.push(m.Body ?? '');
      await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle! }));
    }
  }
  return bodies;
};

const send = (queueUrl: string, body: string) =>
  sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: body,
      MessageGroupId: crypto.randomUUID(),
      MessageDeduplicationId: crypto.randomUUID(),
    }),
  );

const requestBody = (walletId: string, playerId: string, amount: string) => {
  const ext = crypto.randomUUID();
  return JSON.stringify({
    messageId: crypto.randomUUID(),
    type: 'WagerTransactionRequested',
    occurredAt: BASE.toISOString(),
    data: {
      providerId: 'provider-a',
      externalTransactionId: ext,
      idempotencyKey: `provider-a:${ext}`,
      playerId,
      walletId,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: 'BET',
      money: brl(amount),
    },
  });
};

const buildHandler = () =>
  new InboundWagerTransactionHandler(
    new MikroOrmTransactionRunner(orm.em),
    new InboxMessageRepository(orm.em),
    uc.submit,
    clock,
    noopLogContext,
  );

const buildConsumer = () =>
  new SqsWagerTransactionConsumer(sqs, buildHandler(), noopLogger, noopMetrics, noopLogContext);

const openWallet = async (amount: string) => {
  const playerId = crypto.randomUUID();
  const wallet = await inContext(() =>
    uc.createWallet.execute({ playerId, initialBalance: brl(amount) }),
  );
  return { walletId: wallet.id, playerId };
};

describe('messaging concurrency', () => {
  it('processes each message once across three competing consumer instances', async () => {
    const wallets = await Promise.all([
      openWallet('1000.00'),
      openWallet('1000.00'),
      openWallet('1000.00'),
    ]);

    for (const { walletId, playerId } of wallets) {
      for (let i = 0; i < 5; i += 1) {
        await send(QUEUE_URL, requestBody(walletId, playerId, '10.00'));
      }
    }

    const consumers = [buildConsumer(), buildConsumer(), buildConsumer()];
    let handled = 0;
    for (let round = 0; round < 25 && handled < 15; round += 1) {
      const counts = await Promise.all(
        consumers.map((c) => inContext(() => c.pollOnce())),
      );
      handled += counts.reduce((a, b) => a + b, 0);
    }
    expect(handled).toBe(15);

    for (const { walletId } of wallets) {
      const wallet = await inContext(() => uc.getWallet.execute(walletId));
      expect(wallet.balance).toEqual(brl('950.00'));
    }
    expect(await drain(QUEUE_URL)).toHaveLength(0);
  }, 30000);

  it('does not double-apply when a worker commits then dies before the ack', async () => {
    const { walletId, playerId } = await openWallet('100.00');
    const body = requestBody(walletId, playerId, '25.00');

    const first = await inContext(() => buildHandler().handle(body));
    expect(first.status).toBe('processed');

    const redelivered = await inContext(() => buildHandler().handle(body));
    expect(redelivered.status).toBe('duplicate');

    const wallet = await inContext(() => uc.getWallet.execute(walletId));
    expect(wallet.balance).toEqual(brl('75.00'));
  }, 30000);

  it('drains the outbox exactly once under two competing publishers', async () => {
    await inContext(async () => {
      const outbox = new OutboxMessageRepository(orm.em);
      for (let i = 0; i < 12; i += 1) {
        await outbox.save(
          OutboxMessage.enqueue(
            new (class extends IntegrationEvent<{ n: number }> {
              readonly eventType = 'ConcurrencyTestEvent';
              readonly version = 1;
              constructor(props: IntegrationEventProps<{ n: number }>) {
                super(props);
              }
            })({
              eventId: crypto.randomUUID(),
              aggregateId: crypto.randomUUID(),
              correlationId: crypto.randomUUID(),
              occurredAt: clock.now(),
              data: { n: i },
            }),
          ),
        );
      }
    });

    const publisher = () =>
      new OutboxPublisher(
        new MikroOrmTransactionRunner(orm.em),
        new OutboxMessageRepository(orm.em),
        new SqsMessagePublisher(sqs, EVENTS_QUEUE_URL),
        clock,
        noopLogger,
        noopMetrics,
      );

    const [a, b] = await Promise.all([
      inContext(() => publisher().runOnce(20)),
      inContext(() => publisher().runOnce(20)),
    ]);
    expect(a.published + b.published).toBe(12);

    const remaining = await inContext(() =>
      new MikroOrmTransactionRunner(orm.em).run(() =>
        new OutboxMessageRepository(orm.em).findDue(new Date(BASE), 50),
      ),
    );
    expect(remaining).toHaveLength(0);

    const delivered = await drain(EVENTS_QUEUE_URL);
    expect(delivered).toHaveLength(12);
  }, 30000);
});

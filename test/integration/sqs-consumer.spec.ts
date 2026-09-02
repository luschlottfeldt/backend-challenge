import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { MikroORM } from '@mikro-orm/postgresql';
import {
  DeleteMessageCommand,
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { createTestOrm, truncateAll } from './orm-fixture.js';
import { MutableClock, noopLogContext, noopMetrics, wireUseCases } from './wire-use-cases.js';
import { MikroOrmTransactionRunner } from '../../src/infrastructure/database/mikro-orm-transaction-runner.js';
import { InboxMessageRepository } from '../../src/infrastructure/database/repositories/inbox-message.repository.js';
import { InboundWagerTransactionHandler } from '../../src/application/messaging/inbound-wager-transaction.handler.js';
import { SqsWagerTransactionConsumer } from '../../src/infrastructure/messaging/sqs-wager-transaction-consumer.js';

const QUEUE_URL =
  process.env.SQS_WAGER_TRANSACTIONS_QUEUE_URL ??
  'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/wager-transactions.fifo';
const DLQ_URL =
  process.env.SQS_WAGER_TRANSACTIONS_DLQ_URL ??
  'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/wager-transactions-dlq.fifo';

const noopLogger = { info() {}, warn() {}, error() {} };

let orm: MikroORM;
let sqs: SQSClient;
let clock: MutableClock;
let uc: ReturnType<typeof wireUseCases>;
let consumer: SqsWagerTransactionConsumer;

const BASE = new Date('2026-09-01T00:00:00.000Z');

const send = (queueUrl: string, body: string) =>
  sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: body,
      MessageGroupId: crypto.randomUUID(),
      MessageDeduplicationId: crypto.randomUUID(),
    }),
  );

const requestMessage = (over: Record<string, unknown>, messageId = crypto.randomUUID()) => {
  const ext = crypto.randomUUID();
  return JSON.stringify({
    messageId,
    type: 'WagerTransactionRequested',
    occurredAt: BASE.toISOString(),
    data: {
      providerId: 'provider-a',
      externalTransactionId: ext,
      idempotencyKey: `provider-a:${ext}`,
      playerId: crypto.randomUUID(),
      walletId: 'REPLACE',
      roundId: 'round-1',
      gameId: 'game-1',
      kind: 'BET',
      money: { amount: '25.00', currency: 'BRL' },
      ...over,
    },
  });
};

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

beforeAll(async () => {
  process.env.SQS_CONSUMER_WAIT_SECONDS = '1';
  orm = await createTestOrm();
  sqs = new SQSClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: process.env.AWS_SQS_ENDPOINT ?? 'http://localhost:4566',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
  await sqs.send(new PurgeQueueCommand({ QueueUrl: QUEUE_URL })).catch(() => undefined);
  await sqs.send(new PurgeQueueCommand({ QueueUrl: DLQ_URL })).catch(() => undefined);
});

afterAll(async () => {
  await orm.close();
  sqs.destroy();
});

beforeEach(async () => {
  await truncateAll(orm);
  await drain(QUEUE_URL);
  await drain(DLQ_URL);
  clock = new MutableClock(new Date(BASE));
  uc = wireUseCases(orm, clock);
  const handler = new InboundWagerTransactionHandler(
    new MikroOrmTransactionRunner(orm.em),
    new InboxMessageRepository(orm.em),
    uc.submit,
    clock,
    noopLogContext,
  );
  consumer = new SqsWagerTransactionConsumer(sqs, handler, noopLogger, noopMetrics, noopLogContext);
});

const consume = async (expected = 1): Promise<void> => {
  let handled = 0;
  for (let i = 0; i < 15 && handled < expected; i += 1) {
    handled += await consumer.pollOnce();
  }
  expect(handled).toBeGreaterThanOrEqual(expected);
};

const openWallet = async (amount = '100.00') => {
  const playerId = crypto.randomUUID();
  const wallet = await uc.createWallet.execute({
    playerId,
    initialBalance: { amount, currency: 'BRL' },
  });
  return wallet.id;
};

describe('SqsWagerTransactionConsumer', () => {
  it('consumes a valid BET, applies it once and deletes the message', async () => {
    const walletId = await openWallet();
    await send(QUEUE_URL, requestMessage({ walletId }));

    await consume();

    const wallet = await uc.getWallet.execute(walletId);
    expect(wallet.balance).toEqual({ amount: '75.00', currency: 'BRL' });
    expect(await drain(QUEUE_URL)).toHaveLength(0);
  });

  it('does not re-apply a redelivered message with the same messageId', async () => {
    const walletId = await openWallet();
    const messageId = crypto.randomUUID();
    const body = requestMessage({ walletId }, messageId);

    await send(QUEUE_URL, body);
    await consume();
    await send(QUEUE_URL, body);
    await consume();

    const wallet = await uc.getWallet.execute(walletId);
    expect(wallet.balance).toEqual({ amount: '75.00', currency: 'BRL' });
  });

  it('acks a business rejection without touching the balance', async () => {
    const walletId = await openWallet('10.00');
    await send(QUEUE_URL, requestMessage({ walletId, money: { amount: '25.00', currency: 'BRL' } }));

    await consume();

    const wallet = await uc.getWallet.execute(walletId);
    expect(wallet.balance).toEqual({ amount: '10.00', currency: 'BRL' });
    expect(await drain(QUEUE_URL)).toHaveLength(0);
  });

  it('routes a malformed message to the DLQ and deletes it from the main queue', async () => {
    await send(QUEUE_URL, '{ not json');

    await consume();

    expect(await drain(QUEUE_URL)).toHaveLength(0);
    const dead = await drain(DLQ_URL);
    expect(dead).toEqual(['{ not json']);
  });

  it('dead-letters a message whose wallet does not exist', async () => {
    await send(QUEUE_URL, requestMessage({ walletId: crypto.randomUUID() }));

    await consume();

    expect(await drain(QUEUE_URL)).toHaveLength(0);
    expect(await drain(DLQ_URL)).toHaveLength(1);
  });
});

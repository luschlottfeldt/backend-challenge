import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { RequestContext } from '@mikro-orm/core';
import type { MikroORM } from '@mikro-orm/postgresql';
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import type { Subprocess } from 'bun';
import { createTestOrm, truncateAll } from '../integration/orm-fixture.js';
import { MutableClock, wireUseCases } from '../integration/wire-use-cases.js';

const DLQ_URL =
  process.env.SQS_WAGER_TRANSACTIONS_DLQ_URL ??
  'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/wager-transactions-dlq.fifo';

let orm: MikroORM;
let uc: ReturnType<typeof wireUseCases>;
let sqs: SQSClient;
let testQueueUrl: string;
const running: Subprocess[] = [];

const brl = (amount: string) => ({ amount, currency: 'BRL' });
const inContext = <T>(work: () => Promise<T>): Promise<T> => RequestContext.create(orm.em, work);
const count = (sql: string): Promise<number> =>
  orm.em
    .getConnection()
    .execute(sql)
    .then((rows) => (rows as Array<{ c: number }>)[0]!.c);

async function poll(
  read: () => Promise<number>,
  done: (value: number) => boolean,
  timeoutMs: number,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`poll timed out, last value ${value}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function startInstance(): Subprocess {
  const proc = Bun.spawn(['bun', 'test/concurrency/harness/instance.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      INSTANCE_MODE: 'consume',
      SQS_WAGER_TRANSACTIONS_QUEUE_URL: testQueueUrl,
      SQS_WAGER_TRANSACTIONS_DLQ_URL: DLQ_URL,
      SQS_CONSUMER_ENABLED: 'true',
      SQS_CONSUMER_BATCH_SIZE: '1',
      SQS_CONSUMER_WAIT_SECONDS: '1',
      OUTBOX_PUBLISHER_ENABLED: 'true',
      OUTBOX_POLL_INTERVAL_MS: '500',
      REFERENCE_REPROCESS_ENABLED: 'false',
    },
    stdout: 'ignore',
    stderr: 'ignore',
  });
  running.push(proc);
  return proc;
}

async function stop(proc: Subprocess, signal: NodeJS.Signals): Promise<void> {
  proc.kill(signal);
  await proc.exited;
}

const message = (walletId: string, playerId: string, amount: string) => {
  const externalTransactionId = crypto.randomUUID();
  return {
    messageId: crypto.randomUUID(),
    body: JSON.stringify({
      messageId: crypto.randomUUID(),
      type: 'WagerTransactionRequested',
      occurredAt: new Date('2026-09-01T00:00:00.000Z').toISOString(),
      data: {
        providerId: 'provider-a',
        externalTransactionId,
        idempotencyKey: `provider-a:${externalTransactionId}`,
        playerId,
        walletId,
        roundId: 'round-1',
        gameId: 'game-1',
        kind: 'BET',
        money: { amount, currency: 'BRL' },
      },
    }),
  };
};

beforeAll(async () => {
  orm = await createTestOrm();
  sqs = new SQSClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: process.env.AWS_SQS_ENDPOINT ?? 'http://localhost:4566',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
  const created = await sqs.send(
    new CreateQueueCommand({
      QueueName: `wager-transactions-restart-${Date.now()}.fifo`,
      Attributes: {
        FifoQueue: 'true',
        ContentBasedDeduplication: 'false',
        VisibilityTimeout: '2',
      },
    }),
  );
  testQueueUrl = created.QueueUrl!;
});

afterAll(async () => {
  await sqs.send(new DeleteQueueCommand({ QueueUrl: testQueueUrl })).catch(() => undefined);
  sqs.destroy();
  await orm.close();
});

beforeEach(async () => {
  await truncateAll(orm);
  uc = wireUseCases(orm, new MutableClock(new Date('2026-09-01T00:00:00.000Z')));
}, 30000);

afterEach(async () => {
  await Promise.all(running.splice(0).map((proc) => stop(proc, 'SIGKILL')));
});

describe('service restart recovery (SIGKILL mid-workload)', () => {
  it('settles every message exactly once after a hard kill and restart', async () => {
    const playerId = crypto.randomUUID();
    const wallet = await inContext(() =>
      uc.createWallet.execute({ playerId, initialBalance: brl('1000.00') }),
    );
    const messageCount = 6;
    const amount = '50.00';

    for (let i = 0; i < messageCount; i += 1) {
      const m = message(wallet.id, playerId, amount);
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: testQueueUrl,
          MessageBody: m.body,
          MessageGroupId: wallet.id,
          MessageDeduplicationId: m.messageId,
        }),
      );
    }

    const processedBets = `select count(*)::int c from wager_transactions where status = 'PROCESSED' and kind = 'BET'`;

    const first = startInstance();
    await poll(() => count(processedBets), (value) => value >= 1, 20000);
    await stop(first, 'SIGKILL');

    startInstance();
    await poll(() => count(processedBets), (value) => value === messageCount, 40000);

    expect(
      await count(`select count(*)::int c from wallet_ledger_entries where direction = 'DEBIT'`),
    ).toBe(messageCount);
    expect(await count(`select count(*)::int c from inbox_messages`)).toBe(messageCount);

    const stored = await inContext(() => uc.getWallet.execute(wallet.id));
    expect(stored.balance).toEqual(brl('700.00'));

    const report = await inContext(() => uc.reconcile.execute(wallet.id));
    expect(report.consistent).toBe(true);

    await poll(
      () => count(`select count(*)::int c from outbox_messages where published_at is null`),
      (value) => value === 0,
      15000,
    );
  }, 90000);
});

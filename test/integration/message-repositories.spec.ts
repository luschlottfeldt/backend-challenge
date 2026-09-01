import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { MikroORM } from '@mikro-orm/postgresql';
import { createTestOrm, truncateAll } from './orm-fixture.js';
import { InboxMessageRepository } from '../../src/infrastructure/database/repositories/inbox-message.repository.js';
import { OutboxMessageRepository } from '../../src/infrastructure/database/repositories/outbox-message.repository.js';
import { InboxMessage } from '../../src/domain/entities/inbox-message.js';
import { OutboxMessage } from '../../src/domain/entities/outbox-message.js';
import { WagerTransaction } from '../../src/domain/entities/wager-transaction.js';
import { Money } from '../../src/domain/entities/money.js';
import { WagerTransactionKind } from '../../src/domain/enums/wager-transaction-kind.enum.js';
import { FailureCode } from '../../src/domain/enums/failure-code.js';
import { WagerTransactionRejected } from '../../src/domain/events/wager-transaction-rejected.event.js';

let orm: MikroORM;
const NOW = new Date('2026-09-01T00:00:00.000Z');

const outboxMessage = () =>
  OutboxMessage.enqueue(
    WagerTransactionRejected.from(
      WagerTransaction.create({
        id: crypto.randomUUID(),
        providerId: 'p',
        externalTransactionId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        payloadHash: 'h',
        walletId: crypto.randomUUID(),
        playerId: crypto.randomUUID(),
        roundId: 'r',
        gameId: 'g',
        kind: WagerTransactionKind.Bet,
        money: Money.from({ amount: '5.00', currency: 'BRL' }),
        createdAt: NOW,
      }),
      FailureCode.InsufficientFunds,
      { eventId: crypto.randomUUID(), correlationId: 'c', occurredAt: NOW },
    ),
  );

beforeAll(async () => {
  orm = await createTestOrm();
});
afterAll(async () => {
  await orm.close();
});
beforeEach(async () => {
  await truncateAll(orm);
});

describe('InboxMessageRepository', () => {
  it('dedups by (consumerName, messageId) and allows the same messageId for another consumer', async () => {
    await new InboxMessageRepository(orm.em.fork()).save(
      InboxMessage.receive({ messageId: 'm1', consumerName: 'consumer-a', payloadHash: 'h', receivedAt: NOW }),
    );
    await new InboxMessageRepository(orm.em.fork()).save(
      InboxMessage.receive({ messageId: 'm1', consumerName: 'consumer-b', payloadHash: 'h', receivedAt: NOW }),
    );

    expect(await new InboxMessageRepository(orm.em.fork()).findByMessageId('consumer-a', 'm1')).not.toBeNull();
    expect(await new InboxMessageRepository(orm.em.fork()).findByMessageId('consumer-b', 'm1')).not.toBeNull();
    expect(await new InboxMessageRepository(orm.em.fork()).findByMessageId('consumer-c', 'm1')).toBeNull();
  });

  it('has a composite primary key that rejects a duplicate insert at the schema level', async () => {
    const connection = orm.em.getConnection();
    const values = `('c', 'm1', 'h', now())`;
    await connection.execute(
      `insert into inbox_messages (consumer_name, message_id, payload_hash, received_at) values ${values}`,
    );
    await expect(
      connection.execute(
        `insert into inbox_messages (consumer_name, message_id, payload_hash, received_at) values ${values}`,
      ),
    ).rejects.toThrow();
  });

  it('persists markProcessed through the assign path', async () => {
    await new InboxMessageRepository(orm.em.fork()).save(
      InboxMessage.receive({ messageId: 'm1', consumerName: 'c', payloadHash: 'h', receivedAt: NOW }),
    );

    const reloaded = await new InboxMessageRepository(orm.em.fork()).findByMessageId('c', 'm1');
    reloaded!.markProcessed(new Date(NOW.getTime() + 1000));
    await new InboxMessageRepository(orm.em.fork()).save(reloaded!);

    const final = await new InboxMessageRepository(orm.em.fork()).findByMessageId('c', 'm1');
    expect(final!.isProcessed()).toBe(true);
  });
});

describe('OutboxMessageRepository', () => {
  it('findDue returns pending due messages and excludes published / future ones', async () => {
    const repo = new OutboxMessageRepository(orm.em.fork());

    const due = outboxMessage();
    await repo.save(due);

    const published = outboxMessage();
    published.markPublished(NOW);
    await repo.save(published);

    const future = outboxMessage();
    future.scheduleRetry(new Date(NOW.getTime() + 60_000));
    await repo.save(future);

    const found = await orm.em
      .fork()
      .transactional((em) => new OutboxMessageRepository(em).findDue(new Date(NOW.getTime() + 1000), 10));
    expect(found.map((m) => m.id)).toEqual([due.id]);
  });

  it('serves concurrent publishers different rows via SKIP LOCKED', async () => {
    const repo = new OutboxMessageRepository(orm.em.fork());
    const a = outboxMessage();
    const b = outboxMessage();
    await repo.save(a);
    await repo.save(b);

    let firstGrabbed: string | undefined;
    let releaseFirst!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const holder = orm.em.fork().transactional(async (em) => {
      const rows = await new OutboxMessageRepository(em).findDue(new Date(NOW.getTime() + 1000), 1);
      firstGrabbed = rows[0]!.id;
      await held;
    });

    while (!firstGrabbed) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const secondRows = await orm.em
      .fork()
      .transactional((em) => new OutboxMessageRepository(em).findDue(new Date(NOW.getTime() + 1000), 1));

    releaseFirst();
    await holder;

    expect([a.id, b.id]).toContain(firstGrabbed);
    expect(secondRows).toHaveLength(1);
    expect(secondRows[0]!.id).not.toBe(firstGrabbed);
  });
});

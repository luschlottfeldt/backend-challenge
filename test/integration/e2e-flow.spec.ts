import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MikroORM } from '@mikro-orm/postgresql';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';

let app: INestApplication;
let orm: MikroORM;

const brl = (amount: string) => ({ amount, currency: 'BRL' });
const server = () => app.getHttpServer();

beforeAll(async () => {
  process.env.OUTBOX_PUBLISHER_ENABLED = 'false';
  process.env.SQS_CONSUMER_ENABLED = 'false';
  process.env.REFERENCE_REPROCESS_ENABLED = 'false';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.init();
  orm = app.get(MikroORM);
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await orm.em
    .getConnection()
    .execute(
      'truncate table wallets, wager_transactions, wallet_ledger_entries, inbox_messages, outbox_messages cascade',
    );
});

describe('health', () => {
  it('reports liveness and readiness', async () => {
    const live = await request(server()).get('/health/live');
    expect(live.status).toBe(200);
    const ready = await request(server()).get('/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.info.database.status).toBe('up');
  });
});

describe('full wager lifecycle over HTTP', () => {
  it('creates a wallet, applies a BET and a WIN and exposes a consistent ledger', async () => {
    const playerId = crypto.randomUUID();
    const created = await request(server())
      .post('/wallets')
      .set('X-Correlation-Id', 'corr-e2e-1')
      .send({ playerId, initialBalance: brl('500.00') });
    expect(created.status).toBe(201);
    expect(created.headers['x-correlation-id']).toBe('corr-e2e-1');
    const walletId = created.body.id as string;

    const betExt = crypto.randomUUID();
    const bet = await request(server())
      .post('/wagering/transactions')
      .set('Idempotency-Key', `provider-a:${betExt}`)
      .send({
        providerId: 'provider-a',
        externalTransactionId: betExt,
        playerId,
        walletId,
        roundId: 'round-1',
        gameId: 'game-1',
        kind: 'BET',
        money: brl('100.00'),
      });
    expect(bet.status).toBe(200);
    expect(bet.body.balance).toEqual(brl('400.00'));

    const winExt = crypto.randomUUID();
    const win = await request(server())
      .post('/wagering/transactions')
      .set('Idempotency-Key', `provider-a:${winExt}`)
      .send({
        providerId: 'provider-a',
        externalTransactionId: winExt,
        playerId,
        walletId,
        roundId: 'round-1',
        gameId: 'game-1',
        kind: 'WIN',
        money: brl('50.00'),
      });
    expect(win.status).toBe(200);
    expect(win.body.balance).toEqual(brl('450.00'));

    const firstPage = await request(server()).get(`/wallets/${walletId}/ledger?limit=2`);
    expect(firstPage.body.entries).toHaveLength(2);
    expect(firstPage.body.nextCursor).not.toBeNull();

    const secondPage = await request(server()).get(
      `/wallets/${walletId}/ledger?limit=2&cursor=${encodeURIComponent(firstPage.body.nextCursor)}`,
    );
    expect(secondPage.body.entries).toHaveLength(1);
    expect(secondPage.body.nextCursor).toBeNull();

    const lookup = await request(server()).get(
      `/providers/provider-a/wagering/transactions/${betExt}`,
    );
    expect(lookup.body).toMatchObject({ status: 'PROCESSED', kind: 'BET' });

    const recon = await request(server()).post(`/wallets/${walletId}/reconciliation`);
    expect(recon.body).toMatchObject({ consistent: true, checkedEntries: 3 });
  });

  it('serves Prometheus metrics reflecting processed work', async () => {
    const playerId = crypto.randomUUID();
    const created = await request(server())
      .post('/wallets')
      .send({ playerId, initialBalance: brl('100.00') });
    const ext = crypto.randomUUID();
    await request(server())
      .post('/wagering/transactions')
      .set('Idempotency-Key', `provider-a:${ext}`)
      .send({
        providerId: 'provider-a',
        externalTransactionId: ext,
        playerId,
        walletId: created.body.id,
        roundId: 'round-1',
        gameId: 'game-1',
        kind: 'BET',
        money: brl('25.00'),
      });

    const metrics = await request(server()).get('/metrics');
    expect(metrics.status).toBe(200);
    expect(metrics.text).toContain('wager_transactions_settled_total');
    expect(metrics.text).toContain('wager_processing_latency_seconds_bucket');
  });
});

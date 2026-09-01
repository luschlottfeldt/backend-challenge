import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MikroORM } from '@mikro-orm/postgresql';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';

let app: INestApplication;
let orm: MikroORM;

const player = () => crypto.randomUUID();
const brl = (amount: string) => ({ amount, currency: 'BRL' });

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

const server = () => app.getHttpServer();

describe('POST /wallets', () => {
  it('creates a wallet with an opening balance', async () => {
    const playerId = player();
    const res = await request(server())
      .post('/wallets')
      .send({ playerId, initialBalance: brl('1000.00') });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ playerId, balance: brl('1000.00'), version: 1 });
    expect(typeof res.body.id).toBe('string');
  });

  it('rejects a duplicate player + currency as a conflict', async () => {
    const playerId = player();
    await request(server()).post('/wallets').send({ playerId, initialBalance: brl('10.00') });
    const res = await request(server())
      .post('/wallets')
      .send({ playerId, initialBalance: brl('10.00') });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('WALLET_ALREADY_EXISTS');
  });

  it('rejects an invalid body with 400 VALIDATION_FAILED', async () => {
    const res = await request(server())
      .post('/wallets')
      .send({ playerId: 'not-a-uuid', initialBalance: { amount: '10', currency: 'brl' } });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /wagering/transactions', () => {
  const openWallet = async (amount = '100.00') => {
    const playerId = player();
    const res = await request(server())
      .post('/wallets')
      .send({ playerId, initialBalance: brl(amount) });
    return { walletId: res.body.id as string, playerId };
  };

  const betBody = (walletId: string, playerId: string, ext: string, amount = '25.00') => ({
    providerId: 'provider-a',
    externalTransactionId: ext,
    playerId,
    walletId,
    roundId: 'round-1',
    gameId: 'game-1',
    kind: 'BET',
    money: brl(amount),
  });

  it('requires the Idempotency-Key header', async () => {
    const { walletId, playerId } = await openWallet();
    const res = await request(server())
      .post('/wagering/transactions')
      .send(betBody(walletId, playerId, crypto.randomUUID()));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('processes a BET and returns the new balance', async () => {
    const { walletId, playerId } = await openWallet();
    const ext = crypto.randomUUID();
    const res = await request(server())
      .post('/wagering/transactions')
      .set('Idempotency-Key', `provider-a:${ext}`)
      .send(betBody(walletId, playerId, ext));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'PROCESSED',
      balance: brl('75.00'),
      idempotentReplay: false,
    });
  });

  it('replays an identical request', async () => {
    const { walletId, playerId } = await openWallet();
    const ext = crypto.randomUUID();
    const body = betBody(walletId, playerId, ext);
    const key = `provider-a:${ext}`;
    await request(server()).post('/wagering/transactions').set('Idempotency-Key', key).send(body);
    const res = await request(server())
      .post('/wagering/transactions')
      .set('Idempotency-Key', key)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.idempotentReplay).toBe(true);
    expect(res.body.balance).toEqual(brl('75.00'));
  });

  it('flags the same key with a different payload as a conflict', async () => {
    const { walletId, playerId } = await openWallet();
    const ext = crypto.randomUUID();
    const key = `provider-a:${ext}`;
    await request(server())
      .post('/wagering/transactions')
      .set('Idempotency-Key', key)
      .send(betBody(walletId, playerId, ext, '25.00'));
    const res = await request(server())
      .post('/wagering/transactions')
      .set('Idempotency-Key', key)
      .send(betBody(walletId, playerId, ext, '30.00'));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('returns 422 with a failureCode for an insufficient bet', async () => {
    const { walletId, playerId } = await openWallet('10.00');
    const ext = crypto.randomUUID();
    const res = await request(server())
      .post('/wagering/transactions')
      .set('Idempotency-Key', `provider-a:${ext}`)
      .send(betBody(walletId, playerId, ext, '25.00'));

    expect(res.status).toBe(422);
    expect(res.body.failureCode).toBe('INSUFFICIENT_FUNDS');
  });

  it('returns 202 while a refund waits for its reference', async () => {
    const { walletId, playerId } = await openWallet();
    const ext = crypto.randomUUID();
    const res = await request(server())
      .post('/wagering/transactions')
      .set('Idempotency-Key', `provider-a:${ext}`)
      .send({
        ...betBody(walletId, playerId, ext),
        kind: 'REFUND',
        referenceExternalTransactionId: 'missing-bet',
      });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('PENDING_REFERENCE');
  });
});

describe('GET queries', () => {
  it('reads a wallet, its ledger and reconciles it', async () => {
    const playerId = player();
    const created = await request(server())
      .post('/wallets')
      .send({ playerId, initialBalance: brl('50.00') });
    const walletId = created.body.id as string;

    const wallet = await request(server()).get(`/wallets/${walletId}`);
    expect(wallet.status).toBe(200);
    expect(wallet.body.balance).toEqual(brl('50.00'));

    const ledger = await request(server()).get(`/wallets/${walletId}/ledger?limit=10`);
    expect(ledger.status).toBe(200);
    expect(ledger.body.entries).toHaveLength(1);
    expect(ledger.body.nextCursor).toBeNull();

    const recon = await request(server()).post(`/wallets/${walletId}/reconciliation`);
    expect(recon.status).toBe(200);
    expect(recon.body).toMatchObject({ consistent: true, checkedEntries: 1 });
  });

  it('returns 404 for an unknown wallet', async () => {
    const res = await request(server()).get(`/wallets/${crypto.randomUUID()}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('WALLET_NOT_FOUND');
  });

  it('looks a transaction up by provider and external id', async () => {
    const playerId = player();
    const created = await request(server())
      .post('/wallets')
      .send({ playerId, initialBalance: brl('100.00') });
    const walletId = created.body.id as string;
    const ext = crypto.randomUUID();
    await request(server())
      .post('/wagering/transactions')
      .set('Idempotency-Key', `provider-a:${ext}`)
      .send({
        providerId: 'provider-a',
        externalTransactionId: ext,
        playerId,
        walletId,
        roundId: 'round-1',
        gameId: 'game-1',
        kind: 'BET',
        money: brl('25.00'),
      });

    const res = await request(server()).get(
      `/providers/provider-a/wagering/transactions/${ext}`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'PROCESSED', kind: 'BET' });
  });
});

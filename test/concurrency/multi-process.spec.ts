import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { RequestContext } from '@mikro-orm/core';
import type { MikroORM } from '@mikro-orm/postgresql';
import { createTestOrm, truncateAll } from '../integration/orm-fixture.js';
import { MutableClock, wireUseCases } from '../integration/wire-use-cases.js';
import { WagerTransactionStatus } from '../../src/domain/enums/wager-transaction-status.enum.js';
import { WagerTransactionKind } from '../../src/domain/enums/wager-transaction-kind.enum.js';
import { FailureCode } from '../../src/domain/enums/failure-code.js';
import { LedgerDirection } from '../../src/domain/enums/ledger-direction.enum.js';

interface ResultLine {
  type: 'result';
  externalTransactionId: string;
  status?: WagerTransactionStatus;
  failureCode?: FailureCode;
  idempotentReplay?: boolean;
  error?: string;
  message?: string;
}

interface Submission {
  externalTransactionId: string;
  idempotencyKey: string;
  amount: string;
  kind: WagerTransactionKind;
  walletId: string;
  playerId: string;
  roundId: string;
}

let orm: MikroORM;
let uc: ReturnType<typeof wireUseCases>;
const brl = (amount: string) => ({ amount, currency: 'BRL' });
const inContext = <T>(work: () => Promise<T>): Promise<T> => RequestContext.create(orm.em, work);

async function runInstance(submissions: Submission[], startAtEpochMs: number): Promise<ResultLine[]> {
  const proc = Bun.spawn(['bun', 'test/concurrency/harness/instance.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      INSTANCE_MODE: 'submit',
      INSTANCE_JOB: JSON.stringify({ startAtEpochMs, submissions }),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (code !== 0) {
    throw new Error(`submit instance exited ${code}\n${stderr}`);
  }

  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ResultLine)
    .filter((line) => line.type === 'result');
}

const spawnInParallel = (jobs: Submission[][]): Promise<ResultLine[][]> => {
  const startAtEpochMs = Date.now() + 1500;
  return Promise.all(jobs.map((job) => runInstance(job, startAtEpochMs)));
};

const openWallet = (amount: string) => {
  const playerId = crypto.randomUUID();
  return inContext(() => uc.createWallet.execute({ playerId, initialBalance: brl(amount) })).then(
    (wallet) => ({ walletId: wallet.id, playerId }),
  );
};

const bet = (walletId: string, playerId: string, amount: string, shared?: string): Submission => {
  const externalTransactionId = shared ?? crypto.randomUUID();
  return {
    externalTransactionId,
    idempotencyKey: `provider-a:${externalTransactionId}`,
    amount,
    kind: WagerTransactionKind.Bet,
    walletId,
    playerId,
    roundId: 'round-1',
  };
};

beforeAll(async () => {
  orm = await createTestOrm();
});

afterAll(async () => {
  await orm.close();
});

beforeEach(async () => {
  await truncateAll(orm);
  uc = wireUseCases(orm, new MutableClock(new Date('2026-09-01T00:00:00.000Z')));
}, 30000);

describe('multi-process concurrency (>= 3 OS processes, one Postgres)', () => {
  it('lets exactly one of three processes win the contested balance', async () => {
    const { walletId, playerId } = await openWallet('100.00');

    const results = (
      await spawnInParallel([
        [bet(walletId, playerId, '80.00')],
        [bet(walletId, playerId, '80.00')],
        [bet(walletId, playerId, '80.00')],
      ])
    ).flat();

    const processed = results.filter((r) => r.status === WagerTransactionStatus.Processed);
    const rejected = results.filter((r) => r.status === WagerTransactionStatus.Rejected);

    expect(processed).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    expect(rejected.every((r) => r.failureCode === FailureCode.InsufficientFunds)).toBe(true);

    const wallet = await inContext(() => uc.getWallet.execute(walletId));
    expect(wallet.balance).toEqual(brl('20.00'));

    const ledger = await inContext(() => uc.getLedger.execute({ walletId, limit: 200 }));
    expect(ledger.entries.filter((e) => e.direction === LedgerDirection.Debit)).toHaveLength(1);

    const report = await inContext(() => uc.reconcile.execute(walletId));
    expect(report.consistent).toBe(true);
  }, 60000);

  it('applies one shared idempotency key exactly once across three processes', async () => {
    const { walletId, playerId } = await openWallet('1000.00');
    const shared = crypto.randomUUID();
    const command = bet(walletId, playerId, '25.00', shared);

    const results = (
      await spawnInParallel([
        Array.from({ length: 10 }, () => command),
        Array.from({ length: 10 }, () => command),
        Array.from({ length: 10 }, () => command),
      ])
    ).flat();

    expect(results).toHaveLength(30);
    expect(results.every((r) => r.status === WagerTransactionStatus.Processed)).toBe(true);
    expect(results.filter((r) => r.idempotentReplay === false)).toHaveLength(1);

    const wallet = await inContext(() => uc.getWallet.execute(walletId));
    expect(wallet.balance).toEqual(brl('975.00'));

    const ledger = await inContext(() => uc.getLedger.execute({ walletId, limit: 200 }));
    expect(ledger.entries.filter((e) => e.direction === LedgerDirection.Debit)).toHaveLength(1);
  }, 60000);

  it('processes distinct wallets in parallel across processes without cross-contention', async () => {
    const wallets = await Promise.all([openWallet('500.00'), openWallet('500.00'), openWallet('500.00')]);

    const jobs = wallets.map(({ walletId, playerId }) =>
      Array.from({ length: 5 }, () => bet(walletId, playerId, '10.00')),
    );

    const results = (await spawnInParallel(jobs)).flat();
    expect(results.filter((r) => r.status === WagerTransactionStatus.Processed)).toHaveLength(15);

    for (const { walletId } of wallets) {
      const wallet = await inContext(() => uc.getWallet.execute(walletId));
      expect(wallet.balance).toEqual(brl('450.00'));
      const report = await inContext(() => uc.reconcile.execute(walletId));
      expect(report.consistent).toBe(true);
    }
  }, 60000);
});

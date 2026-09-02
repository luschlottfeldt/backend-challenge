import { MikroORM } from '@mikro-orm/postgresql';
import { RequestContext } from '@mikro-orm/core';
import config from '../../../src/mikro-orm.config.js';
import { MutableClock, wireUseCases } from '../../integration/wire-use-cases.js';
import type { WagerTransactionKind } from '../../../src/domain/enums/wager-transaction-kind.enum.js';

interface Submission {
  externalTransactionId: string;
  idempotencyKey: string;
  amount: string;
  kind: WagerTransactionKind;
  walletId: string;
  playerId: string;
  roundId: string;
  referenceExternalTransactionId?: string;
}

interface SubmitJob {
  startAtEpochMs?: number;
  submissions: Submission[];
}

function emit(line: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

async function runSubmit(): Promise<void> {
  const job = JSON.parse(process.env.INSTANCE_JOB ?? '{}') as SubmitJob;
  const orm = await MikroORM.init({ ...config, debug: false });
  const uc = wireUseCases(orm, new MutableClock(new Date()));

  const wait = (job.startAtEpochMs ?? 0) - Date.now();
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }

  for (const submission of job.submissions) {
    const command = {
      idempotencyKey: submission.idempotencyKey,
      providerId: 'provider-a',
      externalTransactionId: submission.externalTransactionId,
      playerId: submission.playerId,
      walletId: submission.walletId,
      roundId: submission.roundId,
      gameId: 'game-1',
      kind: submission.kind,
      money: { amount: submission.amount, currency: 'BRL' },
      referenceExternalTransactionId: submission.referenceExternalTransactionId,
    };

    try {
      const result = await RequestContext.create(orm.em, () => uc.submit.execute(command));
      emit({
        type: 'result',
        externalTransactionId: submission.externalTransactionId,
        status: result.status,
        failureCode: result.failureCode,
        idempotentReplay: result.idempotentReplay,
      });
    } catch (error) {
      emit({
        type: 'result',
        externalTransactionId: submission.externalTransactionId,
        error: (error as Error).name,
        message: (error as Error).message,
      });
    }
  }

  await orm.close();
}

async function runConsume(): Promise<void> {
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../../../src/app.module.js');
  const app = await NestFactory.createApplicationContext(AppModule, {
    abortOnError: false,
    logger: false,
  });
  app.enableShutdownHooks();
  emit({ type: 'ready', pid: process.pid });
  await new Promise(() => {});
}

const mode = process.env.INSTANCE_MODE;
if (mode === 'submit') {
  await runSubmit();
} else if (mode === 'consume') {
  await runConsume();
} else {
  process.stderr.write(`unknown INSTANCE_MODE: ${String(mode)}\n`);
  process.exit(1);
}

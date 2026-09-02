import type { MikroORM } from '@mikro-orm/postgresql';
import { MikroOrmTransactionRunner } from '../../src/infrastructure/database/mikro-orm-transaction-runner.js';
import { WalletRepository } from '../../src/infrastructure/database/repositories/wallet.repository.js';
import { WagerTransactionRepository } from '../../src/infrastructure/database/repositories/wager-transaction.repository.js';
import { WalletLedgerEntryRepository } from '../../src/infrastructure/database/repositories/wallet-ledger-entry.repository.js';
import { OutboxMessageRepository } from '../../src/infrastructure/database/repositories/outbox-message.repository.js';
import { WagerTransactionProcessor } from '../../src/application/services/wager-transaction-processor.js';
import { CreateWalletUseCase } from '../../src/application/use-cases/create-wallet.use-case.js';
import { SubmitWagerTransactionUseCase } from '../../src/application/use-cases/submit-wager-transaction.use-case.js';
import { GetWalletUseCase } from '../../src/application/use-cases/get-wallet.use-case.js';
import { GetWalletLedgerUseCase } from '../../src/application/use-cases/get-wallet-ledger.use-case.js';
import { GetWagerTransactionUseCase } from '../../src/application/use-cases/get-wager-transaction.use-case.js';
import { ReconcileWalletUseCase } from '../../src/application/use-cases/reconcile-wallet.use-case.js';
import { ReprocessPendingReferencesUseCase } from '../../src/application/use-cases/reprocess-pending-references.use-case.js';

export class MutableClock {
  constructor(public current: Date) {}
  now(): Date {
    return this.current;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

const noopLogger = { info() {}, warn() {}, error() {} };
const uuidGenerator = { next: () => crypto.randomUUID() };

export const noopMetrics = {
  transactionSettled() {},
  duplicateDetected() {},
  retryScheduled() {},
  messageDeadLettered() {},
  lockConflict() {},
  reconciliationDivergence() {},
  observeProcessingLatency() {},
  setOutboxLagSeconds() {},
};

export const noopLogContext = {
  run<T>(_fields: unknown, work: () => T): T {
    return work();
  },
  enrich() {},
  current() {
    return {};
  },
};

export function wireUseCases(orm: MikroORM, clock: MutableClock) {
  const em = orm.em;
  const runner = new MikroOrmTransactionRunner(em);
  const wallets = new WalletRepository(em);
  const transactions = new WagerTransactionRepository(em);
  const ledger = new WalletLedgerEntryRepository(em);
  const outbox = new OutboxMessageRepository(em);
  const processor = new WagerTransactionProcessor(
    wallets,
    transactions,
    ledger,
    outbox,
    uuidGenerator,
    noopMetrics,
    noopLogContext,
  );

  return {
    createWallet: new CreateWalletUseCase(
      runner,
      clock,
      uuidGenerator,
      wallets,
      transactions,
      ledger,
      outbox,
      noopMetrics,
    ),
    submit: new SubmitWagerTransactionUseCase(
      runner,
      clock,
      uuidGenerator,
      wallets,
      transactions,
      ledger,
      processor,
      noopMetrics,
    ),
    getWallet: new GetWalletUseCase(wallets),
    getLedger: new GetWalletLedgerUseCase(wallets, ledger),
    getTransaction: new GetWagerTransactionUseCase(transactions),
    reconcile: new ReconcileWalletUseCase(wallets, ledger, noopLogger, noopMetrics),
    reprocess: new ReprocessPendingReferencesUseCase(
      runner,
      clock,
      uuidGenerator,
      noopLogger,
      wallets,
      transactions,
      processor,
    ),
  };
}

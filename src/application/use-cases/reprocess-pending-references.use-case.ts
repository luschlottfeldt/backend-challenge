import { Inject, Injectable } from '@nestjs/common';
import { WagerTransactionStatus } from '../../domain/enums/wager-transaction-status.enum.js';
import type { IWalletRepository } from '../../domain/repositories/wallet.repository.interface.js';
import type { IWagerTransactionRepository } from '../../domain/repositories/wager-transaction.repository.interface.js';
import { WALLET_REPOSITORY, WAGER_TRANSACTION_REPOSITORY } from '../../domain/repositories/tokens.js';
import { TRANSACTION_RUNNER, type TransactionRunner } from '../ports/transaction-runner.js';
import { CLOCK, type Clock } from '../ports/clock.js';
import { ID_GENERATOR, type IdGenerator } from '../ports/id-generator.js';
import { LOGGER, type Logger } from '../ports/logger.js';
import { WagerTransactionProcessor } from '../services/wager-transaction-processor.js';

const DEFAULT_BATCH_SIZE = 20;

type ProcessOneOutcome = 'processed' | 'rejected' | 'rescheduled' | 'skipped';

export interface ReprocessPendingReferencesResult {
  candidates: number;
  processed: number;
  rejected: number;
  rescheduled: number;
  skipped: number;
}

@Injectable()
export class ReprocessPendingReferencesUseCase {
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly runner: TransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(WALLET_REPOSITORY) private readonly wallets: IWalletRepository,
    @Inject(WAGER_TRANSACTION_REPOSITORY) private readonly transactions: IWagerTransactionRepository,
    private readonly processor: WagerTransactionProcessor,
  ) {}

  async execute(batchSize = DEFAULT_BATCH_SIZE): Promise<ReprocessPendingReferencesResult> {
    const candidates = await this.runner.run(() =>
      this.transactions.findPendingReference(this.clock.now(), batchSize),
    );
    const result: ReprocessPendingReferencesResult = {
      candidates: candidates.length,
      processed: 0,
      rejected: 0,
      rescheduled: 0,
      skipped: 0,
    };

    for (const candidate of candidates) {
      const outcome = await this.processOne(candidate.id);
      result[outcome === 'skipped' ? 'skipped' : outcome] += 1;
    }

    if (candidates.length > 0) {
      this.logger.info('reprocessed pending references', {
        candidates: result.candidates,
        processed: result.processed,
        rejected: result.rejected,
        rescheduled: result.rescheduled,
        skipped: result.skipped,
      });
    }

    return result;
  }

  private processOne(transactionId: string): Promise<ProcessOneOutcome> {
    return this.runner.run(async () => {
      const transaction = await this.transactions.findById(transactionId);
      if (!transaction || transaction.status !== WagerTransactionStatus.PendingReference) {
        return 'skipped';
      }

      const wallet = await this.wallets.findByIdForUpdate(transaction.walletId);
      if (!wallet) {
        return 'skipped';
      }

      const outcome = await this.processor.process(transaction, wallet, {
        correlationId: this.ids.next(),
        now: this.clock.now(),
      });

      if (outcome.status === WagerTransactionStatus.Processed) {
        return 'processed';
      }
      if (outcome.status === WagerTransactionStatus.Rejected) {
        return 'rejected';
      }
      return 'rescheduled';
    });
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { Money, type MoneyProps } from '../../domain/entities/money.js';
import { WagerTransaction } from '../../domain/entities/wager-transaction.js';
import type { WagerTransactionKind } from '../../domain/enums/wager-transaction-kind.enum.js';
import { WagerTransactionStatus } from '../../domain/enums/wager-transaction-status.enum.js';
import type { FailureCode } from '../../domain/enums/failure-code.js';
import { WalletNotFoundError } from '../../domain/errors/wallet-not-found.error.js';
import { IdempotencyConflictError } from '../../domain/errors/idempotency-conflict.error.js';
import { PersistenceConflictError } from '../../domain/errors/persistence-conflict.error.js';
import { hashWagerTransactionPayload } from '../../domain/support/payload-hash.js';
import type { IWalletRepository } from '../../domain/repositories/wallet.repository.interface.js';
import type { IWagerTransactionRepository } from '../../domain/repositories/wager-transaction.repository.interface.js';
import type { IWalletLedgerEntryRepository } from '../../domain/repositories/wallet-ledger-entry.repository.interface.js';
import {
  WALLET_REPOSITORY,
  WAGER_TRANSACTION_REPOSITORY,
  WALLET_LEDGER_ENTRY_REPOSITORY,
} from '../../domain/repositories/tokens.js';
import { TRANSACTION_RUNNER, type TransactionRunner } from '../ports/transaction-runner.js';
import { CLOCK, type Clock } from '../ports/clock.js';
import { ID_GENERATOR, type IdGenerator } from '../ports/id-generator.js';
import { METRICS, type Metrics } from '../ports/metrics.js';
import { WagerTransactionProcessor } from '../services/wager-transaction-processor.js';

export interface SubmitWagerTransactionCommand {
  idempotencyKey: string;
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
  correlationId?: string;
  causationId?: string;
}

export interface SubmitWagerTransactionResult {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: MoneyProps | null;
  failureCode?: FailureCode;
  idempotentReplay: boolean;
}

@Injectable()
export class SubmitWagerTransactionUseCase {
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly runner: TransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(WALLET_REPOSITORY) private readonly wallets: IWalletRepository,
    @Inject(WAGER_TRANSACTION_REPOSITORY) private readonly transactions: IWagerTransactionRepository,
    @Inject(WALLET_LEDGER_ENTRY_REPOSITORY) private readonly ledger: IWalletLedgerEntryRepository,
    private readonly processor: WagerTransactionProcessor,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  execute(command: SubmitWagerTransactionCommand): Promise<SubmitWagerTransactionResult> {
    const payloadHash = hashWagerTransactionPayload({
      providerId: command.providerId,
      externalTransactionId: command.externalTransactionId,
      playerId: command.playerId,
      walletId: command.walletId,
      roundId: command.roundId,
      gameId: command.gameId,
      kind: command.kind,
      money: command.money,
      referenceExternalTransactionId: command.referenceExternalTransactionId,
    });

    return this.executeWithRetry(command, payloadHash);
  }

  private async executeWithRetry(
    command: SubmitWagerTransactionCommand,
    payloadHash: string,
  ): Promise<SubmitWagerTransactionResult> {
    try {
      return await this.attempt(command, payloadHash);
    } catch (error) {
      if (!(error instanceof PersistenceConflictError)) {
        throw error;
      }
      this.metrics.lockConflict();
      const raced = await this.runner.run(() =>
        this.replayIfKnown(command.idempotencyKey, payloadHash),
      );
      if (raced) {
        return raced;
      }
      throw error;
    }
  }

  private attempt(
    command: SubmitWagerTransactionCommand,
    payloadHash: string,
  ): Promise<SubmitWagerTransactionResult> {
    return this.runner.run(async () => {
      const replay = await this.replayIfKnown(command.idempotencyKey, payloadHash);
      if (replay) {
        return replay;
      }

      const wallet = await this.wallets.findByIdForUpdate(command.walletId);
      if (!wallet) {
        throw new WalletNotFoundError(command.walletId);
      }

      const now = this.clock.now();
      const transaction = WagerTransaction.create({
        id: this.ids.next(),
        providerId: command.providerId,
        externalTransactionId: command.externalTransactionId,
        idempotencyKey: command.idempotencyKey,
        payloadHash,
        walletId: command.walletId,
        playerId: command.playerId,
        roundId: command.roundId,
        gameId: command.gameId,
        kind: command.kind,
        money: Money.from(command.money),
        referenceExternalTransactionId: command.referenceExternalTransactionId,
        createdAt: now,
      });

      const outcome = await this.processor.process(transaction, wallet, {
        correlationId: command.correlationId ?? this.ids.next(),
        causationId: command.causationId,
        now,
      });

      return {
        transactionId: transaction.id,
        status: outcome.status,
        balance: outcome.balance.toJSON(),
        failureCode: outcome.failureCode,
        idempotentReplay: false,
      };
    });
  }

  private async replayIfKnown(
    idempotencyKey: string,
    payloadHash: string,
  ): Promise<SubmitWagerTransactionResult | null> {
    const existing = await this.transactions.findByIdempotencyKey(idempotencyKey);
    if (!existing) {
      return null;
    }

    if (!existing.matchesPayload(payloadHash)) {
      throw new IdempotencyConflictError(idempotencyKey);
    }

    this.metrics.duplicateDetected('idempotency-key');
    return {
      transactionId: existing.id,
      status: existing.status,
      balance: await this.balanceObservedFor(existing.id, existing.walletId),
      failureCode: existing.failureCode,
      idempotentReplay: true,
    };
  }

  private async balanceObservedFor(
    transactionId: string,
    walletId: string,
  ): Promise<MoneyProps | null> {
    const entry = await this.ledger.findByTransactionId(transactionId);
    if (entry) {
      return entry.balanceAfter.toJSON();
    }
    const wallet = await this.wallets.findById(walletId);
    return wallet ? wallet.balance.toJSON() : null;
  }
}

import { Inject, Injectable } from '@nestjs/common';
import type { Wallet } from '../../domain/entities/wallet.js';
import type { WagerTransaction } from '../../domain/entities/wager-transaction.js';
import type { Money } from '../../domain/entities/money.js';
import { OutboxMessage } from '../../domain/entities/outbox-message.js';
import { LedgerDirection } from '../../domain/enums/ledger-direction.enum.js';
import { WagerTransactionKind } from '../../domain/enums/wager-transaction-kind.enum.js';
import { WagerTransactionStatus } from '../../domain/enums/wager-transaction-status.enum.js';
import { FailureCode } from '../../domain/enums/failure-code.js';
import { WalletBalanceChanged } from '../../domain/events/wallet-balance-changed.event.js';
import { WagerTransactionProcessed } from '../../domain/events/wager-transaction-processed.event.js';
import { WagerTransactionRejected } from '../../domain/events/wager-transaction-rejected.event.js';
import { WagerTransactionPendingReference } from '../../domain/events/wager-transaction-pending-reference.event.js';
import type { EventContext } from '../../domain/events/event-context.js';
import type { IWalletRepository } from '../../domain/repositories/wallet.repository.interface.js';
import type { IWagerTransactionRepository } from '../../domain/repositories/wager-transaction.repository.interface.js';
import type { IWalletLedgerEntryRepository } from '../../domain/repositories/wallet-ledger-entry.repository.interface.js';
import type { IOutboxMessageRepository } from '../../domain/repositories/outbox-message.repository.interface.js';
import {
  WALLET_REPOSITORY,
  WAGER_TRANSACTION_REPOSITORY,
  WALLET_LEDGER_ENTRY_REPOSITORY,
  OUTBOX_MESSAGE_REPOSITORY,
} from '../../domain/repositories/tokens.js';
import { ID_GENERATOR, type IdGenerator } from '../ports/id-generator.js';
import { METRICS, type Metrics } from '../ports/metrics.js';
import { LOG_CONTEXT_STORE, type LogContextStore } from '../ports/log-context.js';

export const MAX_REFERENCE_CHECK_ATTEMPTS = 10;

export interface ProcessContext {
  correlationId: string;
  causationId?: string;
  now: Date;
}

export interface ProcessOutcome {
  status:
    | WagerTransactionStatus.Processed
    | WagerTransactionStatus.Rejected
    | WagerTransactionStatus.PendingReference;
  balance: Money;
  failureCode?: FailureCode;
}

type ReferenceOutcome =
  | { kind: 'resolved'; reference: WagerTransaction }
  | { kind: 'missing' }
  | { kind: 'invalid'; failureCode: FailureCode };

@Injectable()
export class WagerTransactionProcessor {
  constructor(
    @Inject(WALLET_REPOSITORY) private readonly wallets: IWalletRepository,
    @Inject(WAGER_TRANSACTION_REPOSITORY) private readonly transactions: IWagerTransactionRepository,
    @Inject(WALLET_LEDGER_ENTRY_REPOSITORY) private readonly ledger: IWalletLedgerEntryRepository,
    @Inject(OUTBOX_MESSAGE_REPOSITORY) private readonly outbox: IOutboxMessageRepository,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(LOG_CONTEXT_STORE) private readonly logContext: LogContextStore,
  ) {}

  async process(
    transaction: WagerTransaction,
    wallet: Wallet,
    context: ProcessContext,
  ): Promise<ProcessOutcome> {
    this.logContext.enrich({
      transactionId: transaction.id,
      walletId: wallet.id,
      providerId: transaction.providerId,
    });
    const startedAt = performance.now();
    const outcome = await this.runProcess(transaction, wallet, context);
    this.metrics.observeProcessingLatency(
      (performance.now() - startedAt) / 1000,
      outcome.status,
    );
    return outcome;
  }

  private async runProcess(
    transaction: WagerTransaction,
    wallet: Wallet,
    context: ProcessContext,
  ): Promise<ProcessOutcome> {
    const isRetry = transaction.status === WagerTransactionStatus.PendingReference;

    if (transaction.money.currency !== wallet.currency) {
      return this.reject(transaction, wallet, FailureCode.CurrencyMismatch, context);
    }

    let reference: WagerTransaction | undefined;

    if (transaction.requiresReference()) {
      const outcome = await this.resolveReference(transaction);

      if (outcome.kind === 'missing') {
        return this.holdForReference(transaction, wallet, context, isRetry);
      }
      if (outcome.kind === 'invalid') {
        return this.reject(transaction, wallet, outcome.failureCode, context);
      }
      reference = outcome.reference;
    }

    if (transaction.affectsBalance()) {
      const direction = transaction.ledgerDirectionFor(reference);

      if (direction === LedgerDirection.Debit && !wallet.canDebit(transaction.money)) {
        const failureCode =
          transaction.kind === WagerTransactionKind.Bet
            ? FailureCode.InsufficientFunds
            : FailureCode.ReversalWouldOverdraw;
        return this.reject(transaction, wallet, failureCode, context);
      }

      const movement = {
        transactionId: transaction.id,
        ledgerEntryId: this.ids.next(),
        occurredAt: context.now,
      };
      const entry =
        direction === LedgerDirection.Debit
          ? wallet.debit(transaction.money, movement)
          : wallet.credit(transaction.money, movement);

      await this.wallets.save(wallet);
      await this.ledger.save(entry);
      await this.outbox.save(
        OutboxMessage.enqueue(
          WalletBalanceChanged.from(wallet, entry, this.eventContext(context)),
        ),
      );
    }

    transaction.markProcessed(reference?.id, context.now);
    await this.transactions.save(transaction);
    await this.outbox.save(
      OutboxMessage.enqueue(
        WagerTransactionProcessed.from(transaction, this.eventContext(context)),
      ),
    );

    this.metrics.transactionSettled(WagerTransactionStatus.Processed, transaction.kind);
    return { status: WagerTransactionStatus.Processed, balance: wallet.balance };
  }

  private async resolveReference(transaction: WagerTransaction): Promise<ReferenceOutcome> {
    const reference = await this.transactions.findByProviderAndExternalId(
      transaction.providerId,
      transaction.referenceExternalTransactionId as string,
    );

    if (!reference) {
      return { kind: 'missing' };
    }

    if (
      reference.playerId !== transaction.playerId ||
      reference.walletId !== transaction.walletId ||
      reference.roundId !== transaction.roundId ||
      reference.money.currency !== transaction.money.currency
    ) {
      return { kind: 'invalid', failureCode: FailureCode.ReferenceContextMismatch };
    }

    if (reference.status !== WagerTransactionStatus.Processed) {
      return reference.isTerminal()
        ? { kind: 'invalid', failureCode: FailureCode.ReferenceNotProcessed }
        : { kind: 'missing' };
    }

    const allowedKinds =
      transaction.kind === WagerTransactionKind.Refund
        ? [WagerTransactionKind.Bet]
        : [WagerTransactionKind.Bet, WagerTransactionKind.Win, WagerTransactionKind.Refund];
    if (!allowedKinds.includes(reference.kind)) {
      return { kind: 'invalid', failureCode: FailureCode.ReferenceKindNotAllowed };
    }

    if (!transaction.money.equals(reference.money)) {
      return { kind: 'invalid', failureCode: FailureCode.AmountMismatch };
    }

    const existingReversal = await this.transactions.findProcessedReversal(
      reference.id,
      transaction.kind,
    );
    if (existingReversal) {
      return { kind: 'invalid', failureCode: FailureCode.ReferenceAlreadyReversed };
    }

    return { kind: 'resolved', reference };
  }

  private async holdForReference(
    transaction: WagerTransaction,
    wallet: Wallet,
    context: ProcessContext,
    isRetry: boolean,
  ): Promise<ProcessOutcome> {
    if (isRetry && transaction.hasExhaustedReferenceChecks(MAX_REFERENCE_CHECK_ATTEMPTS)) {
      return this.reject(transaction, wallet, FailureCode.ReferenceNotFound, context);
    }

    if (!isRetry) {
      transaction.markPendingReference();
    }
    transaction.scheduleReferenceCheck(context.now);
    await this.transactions.save(transaction);
    this.metrics.retryScheduled('reference');
    if (!isRetry) {
      this.metrics.transactionSettled(WagerTransactionStatus.PendingReference, transaction.kind);
    }

    if (!isRetry) {
      await this.outbox.save(
        OutboxMessage.enqueue(
          WagerTransactionPendingReference.from(
            transaction,
            this.eventContext(context),
          ),
        ),
      );
    }

    return { status: WagerTransactionStatus.PendingReference, balance: wallet.balance };
  }

  private async reject(
    transaction: WagerTransaction,
    wallet: Wallet,
    failureCode: FailureCode,
    context: ProcessContext,
  ): Promise<ProcessOutcome> {
    transaction.reject(failureCode);
    await this.transactions.save(transaction);
    await this.outbox.save(
      OutboxMessage.enqueue(
        WagerTransactionRejected.from(
          transaction,
          failureCode,
          this.eventContext(context),
        ),
      ),
    );
    this.metrics.transactionSettled(WagerTransactionStatus.Rejected, transaction.kind);
    return { status: WagerTransactionStatus.Rejected, balance: wallet.balance, failureCode };
  }

  private eventContext(context: ProcessContext): EventContext {
    return {
      eventId: this.ids.next(),
      correlationId: context.correlationId,
      causationId: context.causationId,
      occurredAt: context.now,
    };
  }
}

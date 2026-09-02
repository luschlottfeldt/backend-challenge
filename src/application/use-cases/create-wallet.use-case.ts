import { Inject, Injectable } from '@nestjs/common';
import { Money, type MoneyProps } from '../../domain/entities/money.js';
import { Wallet } from '../../domain/entities/wallet.js';
import { WagerTransaction } from '../../domain/entities/wager-transaction.js';
import { OutboxMessage } from '../../domain/entities/outbox-message.js';
import { WagerTransactionKind } from '../../domain/enums/wager-transaction-kind.enum.js';
import { WalletBalanceChanged } from '../../domain/events/wallet-balance-changed.event.js';
import { WagerTransactionProcessed } from '../../domain/events/wager-transaction-processed.event.js';
import { WalletAlreadyExistsError } from '../../domain/errors/wallet-already-exists.error.js';
import { PersistenceConflictError } from '../../domain/errors/persistence-conflict.error.js';
import { hashWagerTransactionPayload } from '../../domain/support/payload-hash.js';
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
import { TRANSACTION_RUNNER, type TransactionRunner } from '../ports/transaction-runner.js';
import { CLOCK, type Clock } from '../ports/clock.js';
import { ID_GENERATOR, type IdGenerator } from '../ports/id-generator.js';
import { METRICS, type Metrics } from '../ports/metrics.js';
import { toWalletView, type WalletView } from './views.js';

const INTERNAL_PROVIDER_ID = 'internal';
const OPENING_ROUND_ID = 'opening';
const OPENING_GAME_ID = 'opening';

export interface CreateWalletCommand {
  playerId: string;
  initialBalance: MoneyProps;
  correlationId?: string;
}

@Injectable()
export class CreateWalletUseCase {
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly runner: TransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(WALLET_REPOSITORY) private readonly wallets: IWalletRepository,
    @Inject(WAGER_TRANSACTION_REPOSITORY) private readonly transactions: IWagerTransactionRepository,
    @Inject(WALLET_LEDGER_ENTRY_REPOSITORY) private readonly ledger: IWalletLedgerEntryRepository,
    @Inject(OUTBOX_MESSAGE_REPOSITORY) private readonly outbox: IOutboxMessageRepository,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  execute(command: CreateWalletCommand): Promise<WalletView> {
    return this.runner.run(async () => {
      const money = Money.from(command.initialBalance);
      const currency = money.currency;

      const existing = await this.wallets.findByPlayerAndCurrency(command.playerId, currency);
      if (existing) {
        throw new WalletAlreadyExistsError(command.playerId, currency);
      }

      const now = this.clock.now();
      const correlationId = command.correlationId ?? this.ids.next();
      const walletId = this.ids.next();
      const openingTransactionId = this.ids.next();
      const openingLedgerEntryId = this.ids.next();

      const { wallet, openingEntry } = Wallet.open({
        id: walletId,
        playerId: command.playerId,
        initialBalance: money,
        openingTransactionId,
        openingLedgerEntryId,
        now,
      });

      try {
        await this.wallets.save(wallet);
      } catch (error) {
        if (error instanceof PersistenceConflictError) {
          this.metrics.lockConflict();
          throw new WalletAlreadyExistsError(command.playerId, currency);
        }
        throw error;
      }

      if (openingEntry) {
        const openingTransaction = WagerTransaction.create({
          id: openingTransactionId,
          providerId: INTERNAL_PROVIDER_ID,
          externalTransactionId: openingTransactionId,
          idempotencyKey: `internal:opening:${walletId}`,
          payloadHash: hashWagerTransactionPayload({
            providerId: INTERNAL_PROVIDER_ID,
            externalTransactionId: openingTransactionId,
            playerId: command.playerId,
            walletId,
            roundId: OPENING_ROUND_ID,
            gameId: OPENING_GAME_ID,
            kind: WagerTransactionKind.Opening,
            money: money.toJSON(),
          }),
          walletId,
          playerId: command.playerId,
          roundId: OPENING_ROUND_ID,
          gameId: OPENING_GAME_ID,
          kind: WagerTransactionKind.Opening,
          money,
          createdAt: now,
        });
        openingTransaction.markProcessed(undefined, now);

        await this.transactions.save(openingTransaction);
        await this.ledger.save(openingEntry);
        await this.outbox.save(
          OutboxMessage.enqueue(
            WalletBalanceChanged.from(wallet, openingEntry, {
              eventId: this.ids.next(),
              correlationId,
              occurredAt: now,
            }),
          ),
        );
        await this.outbox.save(
          OutboxMessage.enqueue(
            WagerTransactionProcessed.from(openingTransaction, {
              eventId: this.ids.next(),
              correlationId,
              occurredAt: now,
            }),
          ),
        );
      }

      return toWalletView(wallet);
    });
  }
}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { TerminusModule } from '@nestjs/terminus';
import { APP_FILTER } from '@nestjs/core';
import mikroOrmConfig from './mikro-orm.config.js';
import { WalletsController } from './presentation/controllers/wallets.controller.js';
import { WageringTransactionsController } from './presentation/controllers/wagering-transactions.controller.js';
import { HealthController } from './presentation/controllers/health.controller.js';
import { DomainExceptionFilter } from './presentation/filters/domain-exception.filter.js';
import { WalletRepository } from './infrastructure/database/repositories/wallet.repository.js';
import { WagerTransactionRepository } from './infrastructure/database/repositories/wager-transaction.repository.js';
import { WalletLedgerEntryRepository } from './infrastructure/database/repositories/wallet-ledger-entry.repository.js';
import { InboxMessageRepository } from './infrastructure/database/repositories/inbox-message.repository.js';
import { OutboxMessageRepository } from './infrastructure/database/repositories/outbox-message.repository.js';
import { DatabaseHealthIndicator } from './infrastructure/database/database-health.indicator.js';
import { SqsHealthIndicator } from './infrastructure/messaging/sqs-health.indicator.js';
import { SQS_CLIENT, createSqsClient } from './infrastructure/messaging/sqs-client.provider.js';
import { SqsMessagePublisher } from './infrastructure/messaging/sqs-message-publisher.js';
import { SqsWagerTransactionConsumer } from './infrastructure/messaging/sqs-wager-transaction-consumer.js';
import { OutboxPublisher } from './application/workers/outbox-publisher.js';
import { OutboxPublisherScheduler } from './infrastructure/workers/outbox-publisher.scheduler.js';
import { ReferenceReprocessScheduler } from './infrastructure/workers/reference-reprocess.scheduler.js';
import { InboundWagerTransactionHandler } from './application/messaging/inbound-wager-transaction.handler.js';
import { MESSAGE_PUBLISHER } from './application/ports/message-publisher.js';
import { StructuredLogger } from './infrastructure/logger/structured-logger.service.js';
import { MikroOrmTransactionRunner } from './infrastructure/database/mikro-orm-transaction-runner.js';
import { SystemClock } from './infrastructure/clock/system-clock.js';
import { UuidGenerator } from './infrastructure/id/uuid-generator.js';
import { LoggerAdapter } from './infrastructure/logger/logger.adapter.js';
import { TRANSACTION_RUNNER } from './application/ports/transaction-runner.js';
import { CLOCK } from './application/ports/clock.js';
import { ID_GENERATOR } from './application/ports/id-generator.js';
import { LOGGER } from './application/ports/logger.js';
import { WagerTransactionProcessor } from './application/services/wager-transaction-processor.js';
import { CreateWalletUseCase } from './application/use-cases/create-wallet.use-case.js';
import { SubmitWagerTransactionUseCase } from './application/use-cases/submit-wager-transaction.use-case.js';
import { GetWalletUseCase } from './application/use-cases/get-wallet.use-case.js';
import { GetWalletLedgerUseCase } from './application/use-cases/get-wallet-ledger.use-case.js';
import { GetWagerTransactionUseCase } from './application/use-cases/get-wager-transaction.use-case.js';
import { ReconcileWalletUseCase } from './application/use-cases/reconcile-wallet.use-case.js';
import { ReprocessPendingReferencesUseCase } from './application/use-cases/reprocess-pending-references.use-case.js';
import {
  WALLET_REPOSITORY,
  WAGER_TRANSACTION_REPOSITORY,
  WALLET_LEDGER_ENTRY_REPOSITORY,
  INBOX_MESSAGE_REPOSITORY,
  OUTBOX_MESSAGE_REPOSITORY,
} from './domain/repositories/tokens.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MikroOrmModule.forRoot(mikroOrmConfig),
    TerminusModule,
  ],
  controllers: [WalletsController, WageringTransactionsController, HealthController],
  providers: [
    StructuredLogger,
    DatabaseHealthIndicator,
    SqsHealthIndicator,
    { provide: SQS_CLIENT, useFactory: createSqsClient },
    {
      provide: MESSAGE_PUBLISHER,
      useFactory: (sqs: ReturnType<typeof createSqsClient>) =>
        new SqsMessagePublisher(sqs, process.env.SQS_INTEGRATION_EVENTS_QUEUE_URL ?? ''),
      inject: [SQS_CLIENT],
    },
    OutboxPublisher,
    OutboxPublisherScheduler,
    InboundWagerTransactionHandler,
    SqsWagerTransactionConsumer,
    ReferenceReprocessScheduler,
    { provide: WALLET_REPOSITORY, useClass: WalletRepository },
    { provide: WAGER_TRANSACTION_REPOSITORY, useClass: WagerTransactionRepository },
    { provide: WALLET_LEDGER_ENTRY_REPOSITORY, useClass: WalletLedgerEntryRepository },
    { provide: INBOX_MESSAGE_REPOSITORY, useClass: InboxMessageRepository },
    { provide: OUTBOX_MESSAGE_REPOSITORY, useClass: OutboxMessageRepository },
    { provide: TRANSACTION_RUNNER, useClass: MikroOrmTransactionRunner },
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: UuidGenerator },
    { provide: LOGGER, useClass: LoggerAdapter },
    WagerTransactionProcessor,
    CreateWalletUseCase,
    SubmitWagerTransactionUseCase,
    GetWalletUseCase,
    GetWalletLedgerUseCase,
    GetWagerTransactionUseCase,
    ReconcileWalletUseCase,
    ReprocessPendingReferencesUseCase,
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
  ],
})
export class AppModule {}

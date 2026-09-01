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
import { StructuredLogger } from './infrastructure/logger/structured-logger.service.js';
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
    { provide: WALLET_REPOSITORY, useClass: WalletRepository },
    { provide: WAGER_TRANSACTION_REPOSITORY, useClass: WagerTransactionRepository },
    { provide: WALLET_LEDGER_ENTRY_REPOSITORY, useClass: WalletLedgerEntryRepository },
    { provide: INBOX_MESSAGE_REPOSITORY, useClass: InboxMessageRepository },
    { provide: OUTBOX_MESSAGE_REPOSITORY, useClass: OutboxMessageRepository },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
  ],
})
export class AppModule {}

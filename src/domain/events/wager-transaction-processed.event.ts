import type { MoneyProps } from '../entities/money.js';
import type { WagerTransaction } from '../entities/wager-transaction.js';
import type { WagerTransactionKind } from '../enums/wager-transaction-kind.enum.js';
import { IntegrationEvent } from './integration-event.js';
import type { EventContext } from './event-context.js';

export interface WagerTransactionProcessedData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  affectedBalance: boolean;
  processedAt: string;
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;

  static from(transaction: WagerTransaction, ctx: EventContext): WagerTransactionProcessed {
    return new WagerTransactionProcessed({
      eventId: ctx.eventId,
      aggregateId: transaction.id,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: ctx.occurredAt,
      data: {
        transactionId: transaction.id,
        providerId: transaction.providerId,
        externalTransactionId: transaction.externalTransactionId,
        walletId: transaction.walletId,
        playerId: transaction.playerId,
        roundId: transaction.roundId,
        kind: transaction.kind,
        money: transaction.money.toJSON(),
        affectedBalance: transaction.affectsBalance(),
        processedAt: (transaction.processedAt ?? ctx.occurredAt).toISOString(),
      },
    });
  }
}

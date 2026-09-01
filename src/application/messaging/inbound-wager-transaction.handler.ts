import { Inject, Injectable } from '@nestjs/common';
import { InboxMessage } from '../../domain/entities/inbox-message.js';
import { sha256Hex } from '../../domain/support/sha256.js';
import type { IInboxMessageRepository } from '../../domain/repositories/inbox-message.repository.interface.js';
import { INBOX_MESSAGE_REPOSITORY } from '../../domain/repositories/tokens.js';
import { TRANSACTION_RUNNER, type TransactionRunner } from '../ports/transaction-runner.js';
import { CLOCK, type Clock } from '../ports/clock.js';
import {
  SubmitWagerTransactionUseCase,
  type SubmitWagerTransactionResult,
} from '../use-cases/submit-wager-transaction.use-case.js';
import { parseWagerTransactionMessage } from './wager-transaction-message.js';

export const WAGER_TRANSACTIONS_CONSUMER = 'wager-transactions-consumer';

export type InboundOutcome =
  | { status: 'processed'; messageId: string; result: SubmitWagerTransactionResult }
  | { status: 'duplicate'; messageId: string };

@Injectable()
export class InboundWagerTransactionHandler {
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly runner: TransactionRunner,
    @Inject(INBOX_MESSAGE_REPOSITORY) private readonly inbox: IInboxMessageRepository,
    private readonly submitUseCase: SubmitWagerTransactionUseCase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async handle(rawBody: string): Promise<InboundOutcome> {
    const { messageId, command } = parseWagerTransactionMessage(rawBody);
    const payloadHash = sha256Hex(rawBody);

    return this.runner.run(async () => {
      const existing = await this.inbox.findByMessageId(WAGER_TRANSACTIONS_CONSUMER, messageId);
      if (existing?.isProcessed()) {
        return { status: 'duplicate', messageId };
      }

      const result = await this.submitUseCase.execute(command);

      const record =
        existing ??
        InboxMessage.receive({
          messageId,
          consumerName: WAGER_TRANSACTIONS_CONSUMER,
          payloadHash,
          receivedAt: this.clock.now(),
        });
      record.markProcessed(this.clock.now());
      await this.inbox.save(record);

      return { status: 'processed', messageId, result };
    });
  }
}

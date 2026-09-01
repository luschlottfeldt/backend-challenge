import { Inject, Injectable } from '@nestjs/common';
import { WagerTransactionNotFoundError } from '../../domain/errors/wager-transaction-not-found.error.js';
import type { IWagerTransactionRepository } from '../../domain/repositories/wager-transaction.repository.interface.js';
import { WAGER_TRANSACTION_REPOSITORY } from '../../domain/repositories/tokens.js';
import { toWagerTransactionView, type WagerTransactionView } from './views.js';

@Injectable()
export class GetWagerTransactionUseCase {
  constructor(
    @Inject(WAGER_TRANSACTION_REPOSITORY)
    private readonly transactions: IWagerTransactionRepository,
  ) {}

  async byId(transactionId: string): Promise<WagerTransactionView> {
    const transaction = await this.transactions.findById(transactionId);
    if (!transaction) {
      throw new WagerTransactionNotFoundError(transactionId);
    }
    return toWagerTransactionView(transaction);
  }

  async byProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransactionView> {
    const transaction = await this.transactions.findByProviderAndExternalId(
      providerId,
      externalTransactionId,
    );
    if (!transaction) {
      throw new WagerTransactionNotFoundError(`${providerId}:${externalTransactionId}`);
    }
    return toWagerTransactionView(transaction);
  }
}

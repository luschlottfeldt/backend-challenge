import type { WagerTransaction } from '../entities/wager-transaction.js';

export interface IWagerTransactionRepository {
  findById(id: string): Promise<WagerTransaction | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | null>;
  findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null>;
  findPendingReference(limit: number): Promise<WagerTransaction[]>;
  save(transaction: WagerTransaction): Promise<void>;
}

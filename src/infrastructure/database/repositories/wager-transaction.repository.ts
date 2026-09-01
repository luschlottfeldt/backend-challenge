import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import type { IWagerTransactionRepository } from '../../../domain/repositories/wager-transaction.repository.interface.js';
import type { WagerTransaction } from '../../../domain/entities/wager-transaction.js';

@Injectable()
export class WagerTransactionRepository implements IWagerTransactionRepository {
  constructor(private readonly em: EntityManager) {}

  async findById(_id: string): Promise<WagerTransaction | null> {
    throw new Error('Not implemented');
  }

  async findByIdempotencyKey(_idempotencyKey: string): Promise<WagerTransaction | null> {
    throw new Error('Not implemented');
  }

  async findByProviderAndExternalId(
    _providerId: string,
    _externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    throw new Error('Not implemented');
  }

  async findPendingReference(_limit: number): Promise<WagerTransaction[]> {
    throw new Error('Not implemented');
  }

  async save(_transaction: WagerTransaction): Promise<void> {
    throw new Error('Not implemented');
  }
}

import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import type { TransactionRunner } from '../../application/ports/transaction-runner.js';

@Injectable()
export class MikroOrmTransactionRunner implements TransactionRunner {
  constructor(private readonly em: EntityManager) {}

  run<T>(work: () => Promise<T>): Promise<T> {
    return this.em.transactional(work);
  }
}

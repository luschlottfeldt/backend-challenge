import { MikroORM } from '@mikro-orm/postgresql';
import config from '../../src/mikro-orm.config.js';

export async function createTestOrm(): Promise<MikroORM> {
  return MikroORM.init(config);
}

export async function truncateAll(orm: MikroORM): Promise<void> {
  await orm.em
    .getConnection()
    .execute(
      'truncate table wallets, wager_transactions, wallet_ledger_entries, inbox_messages, outbox_messages cascade',
    );
}

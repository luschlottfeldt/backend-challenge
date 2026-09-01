import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { MikroORM } from '@mikro-orm/postgresql';
import { createTestOrm, truncateAll } from './orm-fixture.js';
import { MikroOrmTransactionRunner } from '../../src/infrastructure/database/mikro-orm-transaction-runner.js';
import { WalletRepository } from '../../src/infrastructure/database/repositories/wallet.repository.js';
import { WagerTransactionRepository } from '../../src/infrastructure/database/repositories/wager-transaction.repository.js';
import { WalletLedgerEntryRepository } from '../../src/infrastructure/database/repositories/wallet-ledger-entry.repository.js';
import { OutboxMessageRepository } from '../../src/infrastructure/database/repositories/outbox-message.repository.js';
import { Wallet } from '../../src/domain/entities/wallet.js';
import { WagerTransaction } from '../../src/domain/entities/wager-transaction.js';
import { OutboxMessage } from '../../src/domain/entities/outbox-message.js';
import { Money } from '../../src/domain/entities/money.js';
import { WagerTransactionKind } from '../../src/domain/enums/wager-transaction-kind.enum.js';
import { WalletBalanceChanged } from '../../src/domain/events/wallet-balance-changed.event.js';

let orm: MikroORM;
const NOW = new Date('2026-09-01T00:00:00.000Z');
const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });

beforeAll(async () => {
  orm = await createTestOrm();
});
afterAll(async () => {
  await orm.close();
});
beforeEach(async () => {
  await truncateAll(orm);
});

describe('MikroOrmTransactionRunner', () => {
  const buildUnit = () => {
    const walletId = crypto.randomUUID();
    const txId = crypto.randomUUID();
    const { wallet } = Wallet.open({
      id: walletId,
      playerId: crypto.randomUUID(),
      initialBalance: brl('100.00'),
      openingTransactionId: txId,
      openingLedgerEntryId: crypto.randomUUID(),
      now: NOW,
    });
    const bet = WagerTransaction.create({
      id: txId,
      providerId: 'p',
      externalTransactionId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      payloadHash: 'h',
      walletId,
      playerId: wallet.playerId,
      roundId: 'r',
      gameId: 'g',
      kind: WagerTransactionKind.Bet,
      money: brl('40.00'),
      createdAt: NOW,
    });
    const entry = wallet.debit(brl('40.00'), {
      transactionId: bet.id,
      ledgerEntryId: crypto.randomUUID(),
      occurredAt: NOW,
    });
    bet.markProcessed(undefined, NOW);
    const event = WalletBalanceChanged.from(wallet, entry, {
      eventId: crypto.randomUUID(),
      correlationId: 'c',
      occurredAt: NOW,
    });
    return { wallet, bet, entry, outbox: OutboxMessage.enqueue(event), walletId };
  };

  it('commits wallet + transaction + ledger + outbox atomically', async () => {
    const runner = new MikroOrmTransactionRunner(orm.em);
    const unit = buildUnit();

    await runner.run(async () => {
      await new WalletRepository(orm.em).save(unit.wallet);
      await new WagerTransactionRepository(orm.em).save(unit.bet);
      await new WalletLedgerEntryRepository(orm.em).save(unit.entry);
      await new OutboxMessageRepository(orm.em).save(unit.outbox);
    });

    expect((await new WalletRepository(orm.em.fork()).findById(unit.walletId))?.balance.toString()).toBe(
      '60.00',
    );
    const ledger = await new WalletLedgerEntryRepository(orm.em.fork()).findByWallet(unit.walletId);
    expect(ledger).toHaveLength(1);
    const due = await orm.em
      .fork()
      .transactional((em) => new OutboxMessageRepository(em).findDue(new Date(NOW.getTime() + 1000), 10));
    expect(due).toHaveLength(1);
  });

  it('rolls the whole unit back when the work throws', async () => {
    const runner = new MikroOrmTransactionRunner(orm.em);
    const unit = buildUnit();

    await expect(
      runner.run(async () => {
        await new WalletRepository(orm.em).save(unit.wallet);
        await new WalletLedgerEntryRepository(orm.em).save(unit.entry);
        await new OutboxMessageRepository(orm.em).save(unit.outbox);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await new WalletRepository(orm.em.fork()).findById(unit.walletId)).toBeNull();
    expect(await new WalletLedgerEntryRepository(orm.em.fork()).findByWallet(unit.walletId)).toHaveLength(0);
    const due = await orm.em
      .fork()
      .transactional((em) => new OutboxMessageRepository(em).findDue(new Date(NOW.getTime() + 1000), 10));
    expect(due).toHaveLength(0);
  });
});

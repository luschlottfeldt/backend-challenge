import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { MikroORM } from '@mikro-orm/postgresql';
import { createTestOrm, truncateAll } from './orm-fixture.js';
import { WalletLedgerEntryRepository } from '../../src/infrastructure/database/repositories/wallet-ledger-entry.repository.js';
import { encodeLedgerCursor } from '../../src/application/pagination/ledger-cursor.js';
import { WalletLedgerEntry } from '../../src/domain/entities/wallet-ledger-entry.js';
import { Money } from '../../src/domain/entities/money.js';
import { LedgerDirection } from '../../src/domain/enums/ledger-direction.enum.js';
import { InvalidLedgerCursorError } from '../../src/domain/errors/invalid-ledger-cursor.error.js';

let orm: MikroORM;
const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });
const WALLET = '00000000-0000-0000-0000-0000000000aa';

const entryAt = (index: number): WalletLedgerEntry =>
  WalletLedgerEntry.create({
    id: crypto.randomUUID(),
    walletId: WALLET,
    transactionId: crypto.randomUUID(),
    direction: LedgerDirection.Credit,
    money: brl('10.00'),
    balanceBefore: brl(`${100 + index * 10}.00`),
    balanceAfter: brl(`${110 + index * 10}.00`),
    createdAt: new Date(Date.parse('2026-09-01T00:00:00.000Z') + index * 1000),
  });

beforeAll(async () => {
  orm = await createTestOrm();
});

afterAll(async () => {
  await orm.close();
});

beforeEach(async () => {
  await truncateAll(orm);
});

describe('WalletLedgerEntryRepository', () => {
  it('appends entries and returns them oldest-first', async () => {
    const repo = new WalletLedgerEntryRepository(orm.em.fork());
    await repo.save(entryAt(0));
    await repo.save(entryAt(1));

    const rows = await new WalletLedgerEntryRepository(orm.em.fork()).findByWallet(WALLET);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.balanceBefore.toString()).toBe('100.00');
    expect(rows[1]!.balanceBefore.toString()).toBe('110.00');
  });

  it('rejects two entries for the same (walletId, transactionId)', async () => {
    const repo = new WalletLedgerEntryRepository(orm.em.fork());
    const first = entryAt(0);
    const clash = WalletLedgerEntry.create({
      id: crypto.randomUUID(),
      walletId: first.walletId,
      transactionId: first.transactionId,
      direction: LedgerDirection.Credit,
      money: brl('10.00'),
      balanceBefore: brl('500.00'),
      balanceAfter: brl('510.00'),
      createdAt: new Date(),
    });
    await repo.save(first);
    await expect(new WalletLedgerEntryRepository(orm.em.fork()).save(clash)).rejects.toThrow();
  });

  it('paginates with a stable opaque cursor', async () => {
    const repo = new WalletLedgerEntryRepository(orm.em.fork());
    const entries = [entryAt(0), entryAt(1), entryAt(2), entryAt(3), entryAt(4)];
    for (const entry of entries) {
      await repo.save(entry);
    }

    const reader = new WalletLedgerEntryRepository(orm.em.fork());
    const page1 = await reader.findByWallet(WALLET, undefined, 2);
    expect(page1.map((e) => e.balanceBefore.toString())).toEqual(['100.00', '110.00']);

    const cursor = encodeLedgerCursor({ createdAt: page1[1]!.createdAt, id: page1[1]!.id });
    const page2 = await reader.findByWallet(WALLET, cursor, 2);
    expect(page2.map((e) => e.balanceBefore.toString())).toEqual(['120.00', '130.00']);

    const cursor2 = encodeLedgerCursor({ createdAt: page2[1]!.createdAt, id: page2[1]!.id });
    const page3 = await reader.findByWallet(WALLET, cursor2, 2);
    expect(page3.map((e) => e.balanceBefore.toString())).toEqual(['140.00']);
  });

  it('rejects a malformed cursor', async () => {
    const repo = new WalletLedgerEntryRepository(orm.em.fork());
    await expect(repo.findByWallet(WALLET, 'not-a-cursor')).rejects.toThrow(InvalidLedgerCursorError);
  });
});

import { defineEntity, p } from '@mikro-orm/postgresql';
import { LedgerDirection } from '../../../domain/enums/ledger-direction.enum.js';

export const WalletLedgerEntrySchema = defineEntity({
  name: 'WalletLedgerEntry',
  tableName: 'wallet_ledger_entries',
  properties: {
    id: p.uuid().primary(),
    walletId: p.uuid(),
    transactionId: p.uuid(),
    direction: p.enum(LedgerDirection),
    amount: p.decimal().precision(19).scale(2),
    currency: p.string().length(3),
    balanceBeforeAmount: p.decimal().precision(19).scale(2),
    balanceAfterAmount: p.decimal().precision(19).scale(2),
    createdAt: p.datetime(),
  },
  uniques: [{ properties: ['walletId', 'transactionId'] }],
});

export class WalletLedgerEntryOrmEntity extends WalletLedgerEntrySchema.class {}
WalletLedgerEntrySchema.setClass(WalletLedgerEntryOrmEntity);

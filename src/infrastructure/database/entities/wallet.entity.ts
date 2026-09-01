import { defineEntity, p } from '@mikro-orm/postgresql';

export const WalletSchema = defineEntity({
  name: 'Wallet',
  tableName: 'wallets',
  properties: {
    id: p.uuid().primary(),
    playerId: p.uuid(),
    currency: p.string().length(3),
    balanceAmount: p.decimal().precision(19).scale(2).check('balance_amount >= 0'),
    version: p.integer().default(1),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  },
  uniques: [{ properties: ['playerId', 'currency'] }],
});

export class WalletOrmEntity extends WalletSchema.class {}
WalletSchema.setClass(WalletOrmEntity);

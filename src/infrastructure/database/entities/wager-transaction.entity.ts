import { defineEntity, p } from '@mikro-orm/postgresql';
import { WagerTransactionKind } from '../../../domain/enums/wager-transaction-kind.enum.js';
import { WagerTransactionStatus } from '../../../domain/enums/wager-transaction-status.enum.js';

export const WagerTransactionSchema = defineEntity({
  name: 'WagerTransaction',
  tableName: 'wager_transactions',
  properties: {
    id: p.uuid().primary(),
    providerId: p.string(),
    externalTransactionId: p.string(),
    idempotencyKey: p.string().unique(),
    payloadHash: p.string(),
    walletId: p.uuid(),
    playerId: p.uuid(),
    roundId: p.string(),
    gameId: p.string(),
    kind: p.enum(WagerTransactionKind),
    amount: p.decimal().precision(19).scale(2),
    currency: p.string().length(3),
    referenceExternalTransactionId: p.string().nullable(),
    createdAt: p.datetime(),
    status: p.enum(WagerTransactionStatus),
    referenceTransactionId: p.uuid().nullable(),
    referenceCheckAttempts: p.integer().default(0),
    nextReferenceCheckAt: p.datetime().nullable(),
    failureCode: p.string().nullable(),
    processedAt: p.datetime().nullable(),
    resultBalanceAmount: p.decimal().precision(19).scale(2).nullable(),
  },
  uniques: [
    { properties: ['providerId', 'externalTransactionId'] },
    { properties: ['referenceTransactionId', 'kind'] },
  ],
  indexes: [
    { properties: ['status', 'nextReferenceCheckAt'] },
    { properties: ['referenceTransactionId'] },
  ],
});

export class WagerTransactionOrmEntity extends WagerTransactionSchema.class {}
WagerTransactionSchema.setClass(WagerTransactionOrmEntity);

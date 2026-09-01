import { WagerTransaction } from '../../../domain/entities/wager-transaction.js';
import type { WagerTransactionKind } from '../../../domain/enums/wager-transaction-kind.enum.js';
import type { WagerTransactionStatus } from '../../../domain/enums/wager-transaction-status.enum.js';
import type { FailureCode } from '../../../domain/enums/failure-code.js';

export interface WagerTransactionRow {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  amount: string;
  currency: string;
  referenceExternalTransactionId: string | null | undefined;
  createdAt: Date;
  status: WagerTransactionStatus;
  referenceTransactionId: string | null | undefined;
  referenceCheckAttempts: number;
  nextReferenceCheckAt: Date | null | undefined;
  failureCode: string | null | undefined;
  processedAt: Date | null | undefined;
}

export const wagerTransactionMapper = {
  toDomain(row: WagerTransactionRow): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: row.id,
      providerId: row.providerId,
      externalTransactionId: row.externalTransactionId,
      idempotencyKey: row.idempotencyKey,
      payloadHash: row.payloadHash,
      walletId: row.walletId,
      playerId: row.playerId,
      roundId: row.roundId,
      gameId: row.gameId,
      kind: row.kind,
      money: { amount: row.amount, currency: row.currency },
      referenceExternalTransactionId: row.referenceExternalTransactionId ?? undefined,
      createdAt: row.createdAt,
      status: row.status,
      referenceTransactionId: row.referenceTransactionId ?? undefined,
      referenceCheckAttempts: row.referenceCheckAttempts,
      nextReferenceCheckAt: row.nextReferenceCheckAt ?? undefined,
      failureCode: (row.failureCode ?? undefined) as FailureCode | undefined,
      processedAt: row.processedAt ?? undefined,
    });
  },

  toPersistence(transaction: WagerTransaction): WagerTransactionRow {
    const money = transaction.money.toJSON();
    return {
      id: transaction.id,
      providerId: transaction.providerId,
      externalTransactionId: transaction.externalTransactionId,
      idempotencyKey: transaction.idempotencyKey,
      payloadHash: transaction.payloadHash,
      walletId: transaction.walletId,
      playerId: transaction.playerId,
      roundId: transaction.roundId,
      gameId: transaction.gameId,
      kind: transaction.kind,
      amount: money.amount,
      currency: money.currency,
      referenceExternalTransactionId: transaction.referenceExternalTransactionId ?? null,
      createdAt: transaction.createdAt,
      status: transaction.status,
      referenceTransactionId: transaction.referenceTransactionId ?? null,
      referenceCheckAttempts: transaction.referenceCheckAttempts,
      nextReferenceCheckAt: transaction.nextReferenceCheckAt ?? null,
      failureCode: transaction.failureCode ?? null,
      processedAt: transaction.processedAt ?? null,
    };
  },
};

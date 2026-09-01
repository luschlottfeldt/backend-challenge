import { Money, type MoneyProps } from '../entities/money.js';
import type { WagerTransactionKind } from '../enums/wager-transaction-kind.enum.js';
import { canonicalJsonStringify } from './canonical-json.js';
import { sha256Hex } from './sha256.js';

export interface WagerTransactionBusinessPayload {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
}

export function hashWagerTransactionPayload(payload: WagerTransactionBusinessPayload): string {
  const normalized = {
    providerId: payload.providerId,
    externalTransactionId: payload.externalTransactionId,
    playerId: payload.playerId,
    walletId: payload.walletId,
    roundId: payload.roundId,
    gameId: payload.gameId,
    kind: payload.kind,
    money: Money.from(payload.money).toJSON(),
    referenceExternalTransactionId: payload.referenceExternalTransactionId,
  };

  return sha256Hex(canonicalJsonStringify(normalized));
}

import { WagerTransactionKind } from '../../domain/enums/wager-transaction-kind.enum.js';
import type { MoneyProps } from '../../domain/entities/money.js';
import type { SubmitWagerTransactionCommand } from '../use-cases/submit-wager-transaction.use-case.js';
import { MalformedMessageError } from './malformed-message.error.js';

export const WAGER_TRANSACTION_REQUESTED = 'WagerTransactionRequested';

const SUBMITTABLE_KINDS = new Set<string>([
  WagerTransactionKind.Bet,
  WagerTransactionKind.Win,
  WagerTransactionKind.Loss,
  WagerTransactionKind.Refund,
  WagerTransactionKind.Rollback,
]);

interface Envelope {
  messageId: string;
  type: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

export interface ParsedInboundMessage {
  messageId: string;
  command: SubmitWagerTransactionCommand;
}

export function parseWagerTransactionMessage(rawBody: string): ParsedInboundMessage {
  const envelope = parseEnvelope(rawBody);
  const data = envelope.data;

  const providerId = str(data, 'providerId');
  const externalTransactionId = str(data, 'externalTransactionId');
  const idempotencyKey =
    typeof data.idempotencyKey === 'string' && data.idempotencyKey.trim() !== ''
      ? data.idempotencyKey
      : `${providerId}:${externalTransactionId}`;
  const kind = str(data, 'kind');
  if (!SUBMITTABLE_KINDS.has(kind)) {
    throw new MalformedMessageError(`unsupported kind "${kind}"`);
  }

  return {
    messageId: envelope.messageId,
    command: {
      idempotencyKey,
      providerId,
      externalTransactionId,
      playerId: str(data, 'playerId'),
      walletId: str(data, 'walletId'),
      roundId: str(data, 'roundId'),
      gameId: str(data, 'gameId'),
      kind: kind as WagerTransactionKind,
      money: money(data.money),
      referenceExternalTransactionId:
        typeof data.referenceExternalTransactionId === 'string'
          ? data.referenceExternalTransactionId
          : undefined,
      correlationId: idempotencyKey,
      causationId: envelope.messageId,
    },
  };
}

function parseEnvelope(rawBody: string): Envelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new MalformedMessageError('body is not valid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new MalformedMessageError('body is not an object');
  }

  const record = parsed as Record<string, unknown>;
  const messageId = record.messageId;
  if (typeof messageId !== 'string' || messageId.trim() === '') {
    throw new MalformedMessageError('missing messageId');
  }
  if (record.type !== WAGER_TRANSACTION_REQUESTED) {
    throw new MalformedMessageError(`unexpected type "${String(record.type)}"`);
  }
  if (typeof record.data !== 'object' || record.data === null) {
    throw new MalformedMessageError('missing data');
  }

  return {
    messageId,
    type: record.type,
    occurredAt: typeof record.occurredAt === 'string' ? record.occurredAt : '',
    data: record.data as Record<string, unknown>,
  };
}

function str(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MalformedMessageError(`missing "${key}"`);
  }
  return value;
}

function money(value: unknown): MoneyProps {
  if (typeof value !== 'object' || value === null) {
    throw new MalformedMessageError('missing "money"');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.amount !== 'string' || typeof record.currency !== 'string') {
    throw new MalformedMessageError('"money" must have string amount and currency');
  }
  return { amount: record.amount, currency: record.currency };
}

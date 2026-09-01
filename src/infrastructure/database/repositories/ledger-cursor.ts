import { InvalidLedgerCursorError } from '../../../domain/errors/invalid-ledger-cursor.error.js';

export interface LedgerCursor {
  createdAt: Date;
  id: string;
}

export function encodeLedgerCursor(cursor: LedgerCursor): string {
  const payload = JSON.stringify({ c: cursor.createdAt.toISOString(), i: cursor.id });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeLedgerCursor(raw: string): LedgerCursor {
  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidLedgerCursorError();
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new InvalidLedgerCursorError();
  }

  const record = parsed as Record<string, unknown>;
  if (typeof record.c !== 'string' || typeof record.i !== 'string') {
    throw new InvalidLedgerCursorError();
  }

  const createdAt = new Date(record.c);
  if (Number.isNaN(createdAt.getTime())) {
    throw new InvalidLedgerCursorError();
  }

  return { createdAt, id: record.i };
}

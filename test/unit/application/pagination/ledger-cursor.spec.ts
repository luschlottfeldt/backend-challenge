import { describe, expect, it } from 'bun:test';
import { encodeLedgerCursor, decodeLedgerCursor } from '../../../../src/application/pagination/ledger-cursor.js';
import { InvalidLedgerCursorError } from '../../../../src/domain/errors/invalid-ledger-cursor.error.js';

describe('ledger cursor', () => {
  it('round-trips createdAt and id opaquely', () => {
    const createdAt = new Date('2026-09-01T12:34:56.789Z');
    const token = encodeLedgerCursor({ createdAt, id: 'entry-7' });
    expect(token).not.toContain('entry-7');
    const decoded = decodeLedgerCursor(token);
    expect(decoded.createdAt.toISOString()).toBe(createdAt.toISOString());
    expect(decoded.id).toBe('entry-7');
  });

  it.each([['not base64', '!!!'], ['not json', Buffer.from('nope').toString('base64url')], ['empty', '']])(
    'rejects a malformed cursor (%s)',
    (_label, token) => {
      expect(() => decodeLedgerCursor(token)).toThrow(InvalidLedgerCursorError);
    },
  );
});

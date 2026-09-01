import { describe, expect, it } from 'bun:test';
import {
  hashWagerTransactionPayload,
  type WagerTransactionBusinessPayload,
} from './payload-hash.js';
import { WagerTransactionKind } from '../enums/wager-transaction-kind.enum.js';

const payload = (
  over: Partial<WagerTransactionBusinessPayload> = {},
): WagerTransactionBusinessPayload => ({
  providerId: 'provider-a',
  externalTransactionId: 'ext-1',
  playerId: 'player-1',
  walletId: 'wallet-1',
  roundId: 'round-1',
  gameId: 'game-1',
  kind: WagerTransactionKind.Bet,
  money: { amount: '25.00', currency: 'BRL' },
  ...over,
});

describe('hashWagerTransactionPayload', () => {
  it('is a 64-char hex sha-256 digest', () => {
    expect(hashWagerTransactionPayload(payload())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic and independent of property order', () => {
    const a: WagerTransactionBusinessPayload = {
      providerId: 'provider-a',
      externalTransactionId: 'ext-1',
      playerId: 'player-1',
      walletId: 'wallet-1',
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      money: { amount: '25.00', currency: 'BRL' },
    };
    const b: WagerTransactionBusinessPayload = {
      money: { currency: 'BRL', amount: '25.00' },
      kind: WagerTransactionKind.Bet,
      gameId: 'game-1',
      roundId: 'round-1',
      walletId: 'wallet-1',
      playerId: 'player-1',
      externalTransactionId: 'ext-1',
      providerId: 'provider-a',
    };
    expect(hashWagerTransactionPayload(a)).toBe(hashWagerTransactionPayload(b));
  });

  it('normalizes the monetary amount through Money', () => {
    expect(hashWagerTransactionPayload(payload({ money: { amount: '25.0', currency: 'BRL' } }))).toBe(
      hashWagerTransactionPayload(payload({ money: { amount: '25.00', currency: 'BRL' } })),
    );
  });

  it('changes when a business field changes', () => {
    const baseline = hashWagerTransactionPayload(payload());
    expect(hashWagerTransactionPayload(payload({ money: { amount: '25.01', currency: 'BRL' } }))).not.toBe(
      baseline,
    );
    expect(hashWagerTransactionPayload(payload({ roundId: 'round-2' }))).not.toBe(baseline);
    expect(
      hashWagerTransactionPayload(payload({ referenceExternalTransactionId: 'ext-bet' })),
    ).not.toBe(baseline);
  });

  it('ignores transport metadata such as the idempotency key', () => {
    const withMetadata = {
      ...payload(),
      idempotencyKey: 'provider-a:ext-1',
      messageId: 'msg-99',
      occurredAt: '2026-09-01T00:00:00.000Z',
    } as WagerTransactionBusinessPayload;
    expect(hashWagerTransactionPayload(withMetadata)).toBe(hashWagerTransactionPayload(payload()));
  });
});

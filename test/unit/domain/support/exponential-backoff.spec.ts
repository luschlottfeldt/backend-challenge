import { describe, expect, it } from 'bun:test';
import { exponentialBackoffDelayMs } from '../../../../src/domain/support/exponential-backoff.js';

describe('exponentialBackoffDelayMs', () => {
  it('doubles from a 5s base', () => {
    expect(exponentialBackoffDelayMs(1)).toBe(5_000);
    expect(exponentialBackoffDelayMs(2)).toBe(10_000);
    expect(exponentialBackoffDelayMs(3)).toBe(20_000);
    expect(exponentialBackoffDelayMs(4)).toBe(40_000);
  });

  it('caps at 1 hour', () => {
    expect(exponentialBackoffDelayMs(100)).toBe(3_600_000);
  });

  it('returns 0 for a non-positive attempt', () => {
    expect(exponentialBackoffDelayMs(0)).toBe(0);
    expect(exponentialBackoffDelayMs(-1)).toBe(0);
  });

  it('honours custom options', () => {
    expect(exponentialBackoffDelayMs(3, { baseDelayMs: 1_000, factor: 3, maxDelayMs: 100_000 })).toBe(
      9_000,
    );
  });
});

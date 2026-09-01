export interface BackoffOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
}

const DEFAULT_BASE_DELAY_MS = 5_000;
const DEFAULT_MAX_DELAY_MS = 3_600_000;
const DEFAULT_FACTOR = 2;

export function exponentialBackoffDelayMs(attempt: number, options: BackoffOptions = {}): number {
  if (attempt <= 0) {
    return 0;
  }

  const base = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const max = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const factor = options.factor ?? DEFAULT_FACTOR;

  return Math.min(base * factor ** (attempt - 1), max);
}

import type { IntegrationEvent } from '../events/integration-event.js';

export interface OutboxMessageState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Readonly<Record<string, unknown>>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt?: Date;
  publishedAt?: Date;
}

export class OutboxMessage {
  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    public readonly payload: Readonly<Record<string, unknown>>,
    public readonly occurredAt: Date,
    private _attempts: number,
    private _nextAttemptAt?: Date,
    private _publishedAt?: Date,
  ) {}

  static enqueue(_event: IntegrationEvent<unknown>): OutboxMessage {
    throw new Error('Not implemented');
  }

  static rehydrate(_state: OutboxMessageState): OutboxMessage {
    throw new Error('Not implemented');
  }

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  isPending(): boolean {
    throw new Error('Not implemented');
  }

  isDue(_now: Date): boolean {
    throw new Error('Not implemented');
  }

  markPublished(_at: Date): void {
    throw new Error('Not implemented');
  }

  scheduleRetry(_now: Date): void {
    throw new Error('Not implemented');
  }
}

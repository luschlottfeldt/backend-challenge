import { Money, type MoneyProps } from './money.js';
import { WagerTransactionKind } from '../enums/wager-transaction-kind.enum.js';
import { WagerTransactionStatus } from '../enums/wager-transaction-status.enum.js';
import { LedgerDirection } from '../enums/ledger-direction.enum.js';
import type { FailureCode } from '../enums/failure-code.js';
import { InvalidTransactionStateError } from '../errors/invalid-transaction-state.error.js';
import { InvalidLedgerEntryError } from '../errors/invalid-ledger-entry.error.js';
import { ReferenceResolutionError } from '../errors/reference-resolution.error.js';
import { exponentialBackoffDelayMs } from '../support/exponential-backoff.js';

export interface CreateWagerTransactionProps {
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
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt: Date;
}

export interface WagerTransactionState {
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
  money: MoneyProps;
  referenceExternalTransactionId?: string;
  createdAt: Date;
  status: WagerTransactionStatus;
  referenceTransactionId?: string;
  referenceCheckAttempts?: number;
  nextReferenceCheckAt?: Date;
  failureCode?: FailureCode;
  processedAt?: Date;
  resultBalance?: MoneyProps;
}

const TRANSITIONS: Record<WagerTransactionStatus, readonly WagerTransactionStatus[]> = {
  [WagerTransactionStatus.Pending]: [
    WagerTransactionStatus.Processed,
    WagerTransactionStatus.PendingReference,
    WagerTransactionStatus.Rejected,
    WagerTransactionStatus.Failed,
  ],
  [WagerTransactionStatus.PendingReference]: [
    WagerTransactionStatus.Processed,
    WagerTransactionStatus.Rejected,
    WagerTransactionStatus.Failed,
  ],
  [WagerTransactionStatus.Processed]: [],
  [WagerTransactionStatus.Rejected]: [],
  [WagerTransactionStatus.Failed]: [],
};

const REFERENCE_REQUIRING_KINDS: readonly WagerTransactionKind[] = [
  WagerTransactionKind.Refund,
  WagerTransactionKind.Rollback,
];

const CREDIT_KINDS: readonly WagerTransactionKind[] = [
  WagerTransactionKind.Win,
  WagerTransactionKind.Refund,
  WagerTransactionKind.Opening,
];

export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: FailureCode,
    private _processedAt?: Date,
    private _referenceCheckAttempts: number = 0,
    private _nextReferenceCheckAt?: Date,
    private _resultBalance?: Money,
  ) {}

  static create(props: CreateWagerTransactionProps): WagerTransaction {
    const transaction = new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      props.createdAt,
      WagerTransactionStatus.Pending,
    );

    if (transaction.requiresReference() && !props.referenceExternalTransactionId) {
      throw ReferenceResolutionError.required();
    }

    return transaction;
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      Money.from(state.money),
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
      state.referenceCheckAttempts ?? 0,
      state.nextReferenceCheckAt,
      state.resultBalance ? Money.from(state.resultBalance) : undefined,
    );
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  get referenceCheckAttempts(): number {
    return this._referenceCheckAttempts;
  }

  get resultBalance(): Money | undefined {
    return this._resultBalance;
  }

  recordResultBalance(balance: Money): void {
    this._resultBalance = balance;
  }

  get nextReferenceCheckAt(): Date | undefined {
    return this._nextReferenceCheckAt;
  }

  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.transitionTo(WagerTransactionStatus.Processed);
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = at;
  }

  markPendingReference(): void {
    this.transitionTo(WagerTransactionStatus.PendingReference);
  }

  scheduleReferenceCheck(now: Date): void {
    if (this._status !== WagerTransactionStatus.PendingReference) {
      throw new InvalidTransactionStateError(this._status, WagerTransactionStatus.PendingReference);
    }
    this._referenceCheckAttempts += 1;
    this._nextReferenceCheckAt = new Date(
      now.getTime() + exponentialBackoffDelayMs(this._referenceCheckAttempts),
    );
  }

  hasExhaustedReferenceChecks(maxAttempts: number): boolean {
    return this._referenceCheckAttempts >= maxAttempts;
  }

  reject(code: FailureCode): void {
    this.transitionTo(WagerTransactionStatus.Rejected);
    this._failureCode = code;
  }

  fail(code: FailureCode): void {
    this.transitionTo(WagerTransactionStatus.Failed);
    this._failureCode = code;
  }

  isTerminal(): boolean {
    return TRANSITIONS[this._status].length === 0;
  }

  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  requiresReference(): boolean {
    return REFERENCE_REQUIRING_KINDS.includes(this.kind);
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    if (this.kind === WagerTransactionKind.Loss) {
      throw new InvalidLedgerEntryError('LOSS does not produce a ledger movement');
    }

    if (this.kind === WagerTransactionKind.Rollback) {
      if (!reference) {
        throw new InvalidLedgerEntryError('ROLLBACK requires its reference to determine direction');
      }
      return reference.ledgerDirectionFor() === LedgerDirection.Debit
        ? LedgerDirection.Credit
        : LedgerDirection.Debit;
    }

    return CREDIT_KINDS.includes(this.kind) ? LedgerDirection.Credit : LedgerDirection.Debit;
  }

  private transitionTo(next: WagerTransactionStatus): void {
    if (!TRANSITIONS[this._status].includes(next)) {
      throw new InvalidTransactionStateError(this._status, next);
    }
    this._status = next;
  }
}

import { Money, type MoneyProps } from './money.js';
import type { WagerTransactionKind } from '../enums/wager-transaction-kind.enum.js';
import type { WagerTransactionStatus } from '../enums/wager-transaction-status.enum.js';
import type { LedgerDirection } from '../enums/ledger-direction.enum.js';
import type { FailureCode } from '../enums/failure-code.type.js';

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
  failureCode?: FailureCode;
  processedAt?: Date;
}

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
  ) {}

  static create(_props: CreateWagerTransactionProps): WagerTransaction {
    throw new Error('Not implemented');
  }

  static rehydrate(_state: WagerTransactionState): WagerTransaction {
    throw new Error('Not implemented');
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

  markProcessed(_referenceTransactionId: string | undefined, _at: Date): void {
    throw new Error('Not implemented');
  }

  markPendingReference(): void {
    throw new Error('Not implemented');
  }

  reject(_code: FailureCode): void {
    throw new Error('Not implemented');
  }

  fail(_code: FailureCode): void {
    throw new Error('Not implemented');
  }

  isTerminal(): boolean {
    throw new Error('Not implemented');
  }

  affectsBalance(): boolean {
    throw new Error('Not implemented');
  }

  requiresReference(): boolean {
    throw new Error('Not implemented');
  }

  matchesPayload(_payloadHash: string): boolean {
    throw new Error('Not implemented');
  }

  ledgerDirectionFor(_reference?: WagerTransaction): LedgerDirection {
    throw new Error('Not implemented');
  }
}

export interface LogFields {
  correlationId?: string;
  messageId?: string;
  transactionId?: string;
  walletId?: string;
  providerId?: string;
}

export interface LogContextStore {
  run<T>(fields: LogFields, work: () => T): T;
  enrich(fields: LogFields): void;
  current(): LogFields;
}

export const LOG_CONTEXT_STORE = Symbol('LogContextStore');

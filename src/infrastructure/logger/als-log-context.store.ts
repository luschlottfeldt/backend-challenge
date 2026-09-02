import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { LogContextStore, LogFields } from '../../application/ports/log-context.js';

@Injectable()
export class AlsLogContextStore implements LogContextStore {
  private readonly storage = new AsyncLocalStorage<LogFields>();

  run<T>(fields: LogFields, work: () => T): T {
    return this.storage.run({ ...this.storage.getStore(), ...prune(fields) }, work);
  }

  enrich(fields: LogFields): void {
    const store = this.storage.getStore();
    if (store) {
      Object.assign(store, prune(fields));
    }
  }

  current(): LogFields {
    return { ...this.storage.getStore() };
  }
}

function prune(fields: LogFields): LogFields {
  const result: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      result[key as keyof LogFields] = value;
    }
  }
  return result;
}

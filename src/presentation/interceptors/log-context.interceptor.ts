import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import {
  LOG_CONTEXT_STORE,
  type LogContextStore,
} from '../../application/ports/log-context.js';

@Injectable()
export class LogContextInterceptor implements NestInterceptor {
  constructor(@Inject(LOG_CONTEXT_STORE) private readonly context: LogContextStore) {}

  intercept(executionContext: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (executionContext.getType() !== 'http') {
      return next.handle();
    }

    const request = executionContext.switchToHttp().getRequest();
    const response = executionContext.switchToHttp().getResponse();
    const header = request.headers['x-correlation-id'];
    const correlationId = typeof header === 'string' && header.trim() !== '' ? header : randomUUID();
    const body: Record<string, unknown> = request.body ?? {};

    response.setHeader('X-Correlation-Id', correlationId);

    return this.context.run(
      {
        correlationId,
        walletId: typeof body.walletId === 'string' ? body.walletId : undefined,
        providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
      },
      () => next.handle(),
    );
  }
}

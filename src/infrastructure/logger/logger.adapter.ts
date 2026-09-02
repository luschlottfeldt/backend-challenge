import { Inject, Injectable } from '@nestjs/common';
import type { Logger, LogContext } from '../../application/ports/logger.js';
import { LOG_CONTEXT_STORE, type LogContextStore } from '../../application/ports/log-context.js';
import { StructuredLogger } from './structured-logger.service.js';

@Injectable()
export class LoggerAdapter implements Logger {
  constructor(
    private readonly logger: StructuredLogger,
    @Inject(LOG_CONTEXT_STORE) private readonly context: LogContextStore,
  ) {}

  info(message: string, context?: LogContext): void {
    this.logger.log(this.merge(message, context));
  }

  warn(message: string, context?: LogContext): void {
    this.logger.warn(this.merge(message, context));
  }

  error(message: string, context?: LogContext): void {
    this.logger.error(this.merge(message, context));
  }

  private merge(message: string, context?: LogContext): Record<string, unknown> {
    return { message, ...this.context.current(), ...context };
  }
}

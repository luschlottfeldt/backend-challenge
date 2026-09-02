import {
  Catch,
  HttpException,
  HttpStatus,
  Inject,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  LockWaitTimeoutException,
  DeadlockException,
  ConnectionException,
} from '@mikro-orm/core';
import { DomainError } from '../../domain/errors/domain-error.js';
import { WagerRejectionError } from '../../domain/errors/wager-rejection.error.js';
import { WagerFailureError } from '../../domain/errors/wager-failure.error.js';
import { IdempotencyConflictError } from '../../domain/errors/idempotency-conflict.error.js';
import { WalletAlreadyExistsError } from '../../domain/errors/wallet-already-exists.error.js';
import { PersistenceConflictError } from '../../domain/errors/persistence-conflict.error.js';
import { WalletNotFoundError } from '../../domain/errors/wallet-not-found.error.js';
import { WagerTransactionNotFoundError } from '../../domain/errors/wager-transaction-not-found.error.js';
import { InvalidLedgerCursorError } from '../../domain/errors/invalid-ledger-cursor.error.js';
import { InvalidMoneyError } from '../../domain/errors/invalid-money.error.js';
import { LOGGER, type Logger } from '../../application/ports/logger.js';
import { METRICS, type Metrics } from '../../application/ports/metrics.js';

interface ErrorBody {
  code: string;
  message: string;
  failureCode?: string;
  details?: unknown;
}

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  constructor(
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.resolve(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error('unhandled error while serving request', {
        code: body.code,
        message: body.message,
        error: exception instanceof Error ? exception.stack : String(exception),
      });
    }

    response.status(status).json(body);
  }

  private resolve(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    if (exception instanceof IdempotencyConflictError) {
      return this.build(HttpStatus.CONFLICT, exception);
    }

    if (
      exception instanceof WalletAlreadyExistsError ||
      exception instanceof PersistenceConflictError
    ) {
      return this.build(HttpStatus.CONFLICT, exception);
    }

    if (exception instanceof WagerRejectionError) {
      return this.build(HttpStatus.UNPROCESSABLE_ENTITY, exception);
    }

    if (
      exception instanceof WalletNotFoundError ||
      exception instanceof WagerTransactionNotFoundError
    ) {
      return this.build(HttpStatus.NOT_FOUND, exception);
    }

    if (
      exception instanceof InvalidLedgerCursorError ||
      exception instanceof InvalidMoneyError
    ) {
      return this.build(HttpStatus.BAD_REQUEST, exception);
    }

    if (
      exception instanceof LockWaitTimeoutException ||
      exception instanceof DeadlockException ||
      exception instanceof ConnectionException
    ) {
      if (!(exception instanceof ConnectionException)) {
        this.metrics.lockConflict();
      }
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        body: {
          code: 'TRANSIENT_INFRASTRUCTURE_ERROR',
          message: 'The service is temporarily unable to process the request; retry later',
        },
      };
    }

    if (exception instanceof WagerFailureError || exception instanceof DomainError) {
      return this.build(HttpStatus.INTERNAL_SERVER_ERROR, exception);
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    };
  }

  private fromHttpException(exception: HttpException): { status: number; body: ErrorBody } {
    const status = exception.getStatus();
    const payload = exception.getResponse();

    if (status === HttpStatus.BAD_REQUEST) {
      const details =
        typeof payload === 'object' && payload !== null && 'message' in payload
          ? (payload as { message: unknown }).message
          : undefined;
      return {
        status,
        body: {
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed',
          details,
        },
      };
    }

    const message =
      typeof payload === 'object' && payload !== null && 'message' in payload
        ? String((payload as { message: unknown }).message)
        : exception.message;

    return { status, body: { code: this.slug(status), message } };
  }

  private build(status: number, error: DomainError): { status: number; body: ErrorBody } {
    const carriesFailureCode =
      error instanceof WagerRejectionError || error instanceof WagerFailureError;
    return {
      status,
      body: {
        code: error.code,
        message: error.message,
        ...(carriesFailureCode ? { failureCode: error.code } : {}),
      },
    };
  }

  private slug(status: number): string {
    return String(HttpStatus[status] ?? 'ERROR');
  }
}

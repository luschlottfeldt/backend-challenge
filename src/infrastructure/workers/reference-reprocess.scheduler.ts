import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ReprocessPendingReferencesUseCase } from '../../application/use-cases/reprocess-pending-references.use-case.js';
import { LOGGER, type Logger } from '../../application/ports/logger.js';
import {
  LOG_CONTEXT_STORE,
  type LogContextStore,
} from '../../application/ports/log-context.js';

@Injectable()
export class ReferenceReprocessScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private stopped = false;

  constructor(
    private readonly useCase: ReprocessPendingReferencesUseCase,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(LOG_CONTEXT_STORE) private readonly logContext: LogContextStore,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.REFERENCE_REPROCESS_ENABLED === 'false') {
      return;
    }
    const intervalMs = Number(process.env.REFERENCE_REPROCESS_INTERVAL_MS ?? 5000);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
    this.logger.info('reference reprocess worker started', { intervalMs });
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
    }
    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopped) {
      return;
    }
    this.running = true;
    try {
      await this.logContext.run({ correlationId: randomUUID() }, () => this.useCase.execute());
    } catch (error) {
      this.logger.error('reference reprocess tick failed', {
        error: (error as Error).message,
      });
    } finally {
      this.running = false;
    }
  }
}

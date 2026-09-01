import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { OutboxPublisher } from '../../application/workers/outbox-publisher.js';
import { LOGGER, type Logger } from '../../application/ports/logger.js';

@Injectable()
export class OutboxPublisherScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private stopped = false;

  constructor(
    private readonly publisher: OutboxPublisher,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.OUTBOX_PUBLISHER_ENABLED === 'false') {
      return;
    }
    const intervalMs = Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 1000);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
    this.logger.info('outbox publisher started', { intervalMs });
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
      const result = await this.publisher.runOnce();
      if (result.published > 0 || result.retried > 0) {
        this.logger.info('outbox publisher tick', {
          claimed: result.claimed,
          published: result.published,
          retried: result.retried,
        });
      }
    } catch (error) {
      this.logger.error('outbox publisher tick failed', {
        error: (error as Error).message,
      });
    } finally {
      this.running = false;
    }
  }
}

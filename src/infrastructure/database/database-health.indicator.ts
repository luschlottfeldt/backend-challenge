import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { EntityManager } from '@mikro-orm/postgresql';

@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    private readonly em: EntityManager,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async check(key: string) {
    const indicator = this.healthIndicatorService.check(key);
    try {
      await this.em.getConnection().execute('select 1');
      return indicator.up();
    } catch (error) {
      return indicator.down({ message: (error as Error).message });
    }
  }
}

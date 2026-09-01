import { describe, expect, it } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../../src/mikro-orm.config.js';

describe('database connectivity', () => {
  it('connects to the real Postgres instance from docker-compose', async () => {
    const orm = await MikroORM.init(config);
    const [{ result }] = await orm.em.getConnection().execute<{ result: number }[]>('select 1 as result');
    await orm.close();
    expect(result).toBe(1);
  });
});

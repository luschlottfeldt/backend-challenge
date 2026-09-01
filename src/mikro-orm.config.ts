import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';

export default defineConfig({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? 'wagering',
  password: process.env.DB_PASSWORD ?? 'wagering',
  dbName: process.env.DB_NAME ?? 'wagering',
  entities: ['./dist/infrastructure/database/entities/**/*.entity.js'],
  entitiesTs: ['./src/infrastructure/database/entities/**/*.entity.ts'],
  extensions: [Migrator],
  migrations: {
    path: './dist/infrastructure/database/migrations',
    pathTs: './src/infrastructure/database/migrations',
  },
  debug: process.env.NODE_ENV !== 'production',
});

/**
 * Seed script for development database.
 * Run after migrations: pnpm --filter @protoimsg/server db:migrate && pnpm --filter @protoimsg/server db:seed
 */
import { loadConfig } from '../config.js';
import { initLogger, createLogger } from '../logger.js';
import { createDb } from './client.js';

async function seed(): Promise<void> {
  const config = loadConfig();
  initLogger(config);
  const log = createLogger('seed');
  const sql = createDb(config.DATABASE_URL);

  log.info('Seeding development database...');
  // No seed data needed — buddy list and calls are user-driven
  log.info('Seed complete (no-op)');
  await sql.end();
}

seed().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

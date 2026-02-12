import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../config.js';
import { initLogger, createLogger } from '../logger.js';
import { createDb } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

async function migrate() {
  const config = loadConfig();
  initLogger(config);
  const log = createLogger('migrate');
  const sql = createDb(config.DATABASE_URL);

  log.info('Running migrations...');

  // Bootstrap: ensure schema_migrations exists (idempotent)
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      run_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const name of files) {
    const applied = await sql`
      SELECT 1 FROM schema_migrations WHERE name = ${name}
    `;
    if (applied.length > 0) {
      log.info({ migration: name }, 'Skip (already applied)');
      continue;
    }

    const path = join(MIGRATIONS_DIR, name);
    const body = readFileSync(path, 'utf-8');
    await sql.unsafe(body);
    await sql`INSERT INTO schema_migrations (name) VALUES (${name})`;
    log.info({ migration: name }, 'Applied');
  }

  log.info('Migrations complete');
  await sql.end();
}

migrate().catch((err: unknown) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

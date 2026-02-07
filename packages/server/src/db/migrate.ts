import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../config.js';
import { createDb } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const config = loadConfig();
  const sql = createDb(config.DATABASE_URL);

  console.log('Running migrations...');

  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  await sql.unsafe(schema);

  console.log('Migrations complete');
  await sql.end();
}

migrate().catch((err: unknown) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

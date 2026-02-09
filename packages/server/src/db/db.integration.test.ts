/**
 * Integration test: real DB connection.
 * Requires DATABASE_URL (e.g. CI or local Docker Postgres).
 * Skipped when DATABASE_URL is not set.
 */
import { afterAll, describe, expect, it } from 'vitest';
import type { Sql } from './client.js';
import { createDb } from './client.js';

const DATABASE_URL = process.env.DATABASE_URL;
const skipIntegration = !DATABASE_URL || DATABASE_URL.includes('undefined');
const sql: Sql | null = !skipIntegration && DATABASE_URL ? createDb(DATABASE_URL) : null;

afterAll(async () => {
  if (sql) await sql.end();
});

describe('DB integration', () => {
  it.skipIf(skipIntegration)('connects and can run a query', async () => {
    if (!sql) throw new Error('No DB client');
    const [{ ok }] = await sql.unsafe<[{ ok: number }]>('SELECT 1 as ok');
    expect(ok).toBe(1);
  });

  it.skipIf(skipIntegration)('has schema_migrations table after migrate', async () => {
    if (!sql) throw new Error('No DB client');
    const rows = await sql.unsafe<{ version: string }[]>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(0);
  });
});

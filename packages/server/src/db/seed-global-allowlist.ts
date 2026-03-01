/**
 * Seed script for global allowlist.
 * Resolves Bluesky handles to DIDs via the public API, then upserts into global_allowlist.
 * Idempotent — safe to re-run.
 *
 * Usage: pnpm --filter @protoimsg/server db:seed-allowlist
 */
import { USER_AGENT } from '@protoimsg/shared';
import { loadConfig } from '../config.js';
import { initLogger, createLogger } from '../logger.js';
import { createDb } from './client.js';

const ALLOWED_ACCOUNTS: Array<{ handle: string; reason: string }> = [
  { handle: 'grinta.cryptoanarchy.network', reason: 'Admin' },
  { handle: '81111.bsky.social', reason: 'Trusted user' },
  { handle: 'ktranektrane.bsky.social', reason: 'Trusted user' },
  { handle: 'grisha.myatproto.social', reason: 'Admin alt' },
  { handle: 'grishalr.bsky.social', reason: 'Admin alt' },
  { handle: 'yul-pay.bsky.social', reason: 'Trusted user' },
];

const RESOLVE_URL = 'https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle';

async function resolveDid(handle: string): Promise<string | null> {
  const url = `${RESOLVE_URL}?handle=${encodeURIComponent(handle)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) return null;
  const data = (await res.json()) as { did: string };
  return data.did;
}

async function seed(): Promise<void> {
  const config = loadConfig();
  initLogger(config);
  const log = createLogger('seed-global-allowlist');
  const sql = createDb(config.DATABASE_URL);

  log.info('Resolving handles and seeding global allowlist...');

  let inserted = 0;
  for (const { handle, reason } of ALLOWED_ACCOUNTS) {
    const did = await resolveDid(handle);
    if (!did) {
      log.warn({ handle }, 'Failed to resolve handle — skipping');
      continue;
    }

    await sql`
      INSERT INTO global_allowlist (did, handle, reason, added_by)
      VALUES (${did}, ${handle}, ${reason}, ${'seed-script'})
      ON CONFLICT (did) DO UPDATE SET
        handle = EXCLUDED.handle,
        reason = EXCLUDED.reason,
        added_by = EXCLUDED.added_by
    `;
    log.info({ did, handle }, 'Upserted allowlist entry');
    inserted++;
  }

  log.info({ inserted, total: ALLOWED_ACCOUNTS.length }, 'Seed complete');
  await sql.end();
}

seed().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

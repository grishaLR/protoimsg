/**
 * Seed script for global account bans.
 * Resolves Bluesky handles to DIDs via the public API, then upserts into global_bans.
 * Idempotent — safe to re-run.
 *
 * Usage: pnpm --filter @protoimsg/server db:seed-bans
 */
import { loadConfig } from '../config.js';
import { initLogger, createLogger } from '../logger.js';
import { createDb } from './client.js';

const BANNED_ACCOUNTS: Array<{ handle: string; reason: string }> = [
  { handle: 'icegov.bsky.social', reason: 'Government agency (ICE)' },
  { handle: 'homelandcbp.bsky.social', reason: 'Government agency (CBP)' },
  { handle: 'homelandgov.bsky.social', reason: 'Government agency (DHS)' },
  { handle: 'whitehouse-47.bsky.social', reason: 'Government agency (White House)' },
];

const RESOLVE_URL = 'https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle';

async function resolveDid(handle: string): Promise<string | null> {
  const url = `${RESOLVE_URL}?handle=${encodeURIComponent(handle)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as { did: string };
  return data.did;
}

async function seed(): Promise<void> {
  const config = loadConfig();
  initLogger(config);
  const log = createLogger('seed-global-bans');
  const sql = createDb(config.DATABASE_URL);

  log.info('Resolving handles and seeding global bans...');

  let inserted = 0;
  for (const { handle, reason } of BANNED_ACCOUNTS) {
    const did = await resolveDid(handle);
    if (!did) {
      log.warn({ handle }, 'Failed to resolve handle — skipping');
      continue;
    }

    await sql`
      INSERT INTO global_bans (did, handle, reason, added_by)
      VALUES (${did}, ${handle}, ${reason}, ${'seed-script'})
      ON CONFLICT (did) DO UPDATE SET
        handle = EXCLUDED.handle,
        reason = EXCLUDED.reason,
        added_by = EXCLUDED.added_by
    `;
    log.info({ did, handle }, 'Upserted global ban');
    inserted++;
  }

  log.info({ inserted, total: BANNED_ACCOUNTS.length }, 'Seed complete');
  await sql.end();
}

seed().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

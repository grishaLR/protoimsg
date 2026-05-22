#!/usr/bin/env node
/**
 * Fix the typo in the game-master bot's display name:
 *   "...proto Instant Messanger" → "...proto Instant Messenger"
 *
 * The display name lives on the bot's `app.bsky.actor.profile` record, not in
 * the repo — so this logs in as the bot and rewrites it. Idempotent: it only
 * touches `displayName`, and only when the typo is actually present.
 *
 * Usage (from packages/server/):
 *   pnpm exec tsx --env-file=.env scripts/fix-bot-display-name.ts --dry-run
 *   ... then re-run without --dry-run to actually write.
 *
 * Reads GAME_MASTER_IDENTIFIER + GAME_MASTER_PASSWORD (already in the server
 * .env), and PDS_URL (defaults to https://pds.protoimsg.app).
 */

import { AtpAgent } from '@atproto/api';

const COLLECTION = 'app.bsky.actor.profile';
const RKEY = 'self';
const TYPO = 'Messanger';
const FIX = 'Messenger';

const dryRun = process.argv.includes('--dry-run');

const pdsUrl = process.env.PDS_URL ?? 'https://pds.protoimsg.app';
const identifier = process.env.GAME_MASTER_IDENTIFIER;
const password = process.env.GAME_MASTER_PASSWORD;

if (!identifier || !password) {
  console.error('Missing env vars. Set GAME_MASTER_IDENTIFIER and GAME_MASTER_PASSWORD.');
  process.exit(1);
}

async function main() {
  const agent = new AtpAgent({ service: pdsUrl });
  await agent.login({ identifier: identifier!, password: password! });
  const did = agent.session!.did;

  console.log(`\nAuthenticated as ${did}`);
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN' : '🔥 LIVE WRITE'}\n`);

  const res = await agent.com.atproto.repo
    .getRecord({ repo: did, collection: COLLECTION, rkey: RKEY })
    .catch(() => null);
  if (!res) {
    console.log('No app.bsky.actor.profile/self record found — nothing to do.');
    return;
  }

  const record = res.data.value as Record<string, unknown>;
  const current = typeof record.displayName === 'string' ? record.displayName : '';
  if (!current.includes(TYPO)) {
    console.log(`displayName is "${current}" — no "${TYPO}" typo found, nothing to do.`);
    return;
  }

  const fixed = current.split(TYPO).join(FIX);
  console.log(`displayName: "${current}"`);
  console.log(`         →   "${fixed}"`);

  if (dryRun) {
    console.log('\nDry run — re-run without --dry-run to apply.');
    return;
  }

  // Preserve every other profile field (description, avatar, banner, …).
  await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: COLLECTION,
    rkey: RKEY,
    record: { ...record, displayName: fixed },
  });
  console.log('\n✅ Wrote profile — display name fixed.');
}

main().catch((err) => {
  console.error('Fatal:', err.message ?? err);
  process.exit(1);
});

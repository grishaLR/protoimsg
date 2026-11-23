#!/usr/bin/env node
/**
 * Publish (or update) the arcade games' `games.atmosphere.define` records
 * (https://atmosphere.games/docs#define) in the game master's repo.
 *
 * These are production records: one per game, under a stable key. Portals
 * read them to list the games, and the web client's opt-in "now playing"
 * status (`games.atmosphere.status`, see
 * packages/web/src/hooks/useGameStatus.ts) points at them:
 *
 *   at://<game master DID>/games.atmosphere.define/<rkey>
 *
 * Run by hand: once before a game's live status ships, and again whenever its
 * listing changes. Re-running is safe — an existing record is updated in
 * place and keeps its createdAt.
 *
 * Nothing is written unless --write is passed: by default it only prints what
 * it would publish. It also refuses to run as any account other than the game
 * master the web client points at (override with GAME_MASTER_DID if the
 * client is built with a different VITE_GAME_MASTER_DID).
 *
 * Usage (from packages/server):
 *   PDS_URL=https://pds.protoimsg.app \
 *   BLUESKY_HANDLE=<game-master-handle> \
 *   BLUESKY_APP_PASSWORD=xxxx-xxxx \
 *   npx tsx scripts/game-defines/publish.ts            # every game, dry run
 *   npx tsx scripts/game-defines/publish.ts --write    # every game, publish
 *   npx tsx scripts/game-defines/publish.ts hurdles    # just the named game(s)
 *
 * Adding a game:
 *   1. Add `<game>.ts` next to this file, exporting its GameDefine (copy
 *      hurdles.ts). Its `rkey` is permanent.
 *   2. Add it to GAMES below.
 *   3. If it should show a live status, add it to `StatusGame` / `GAME_INFO`
 *      in packages/web/src/hooks/useGameStatus.ts.
 */

import { AtpAgent } from '@atproto/api';
import type { GameDefine } from './shared.js';
import { hopper } from './hopper.js';
import { hurdles } from './hurdles.js';

/** Every game this script publishes. */
const GAMES: GameDefine[] = [hopper, hurdles];

const COLLECTION = 'games.atmosphere.define';
const PLAY_URL = 'https://protoimsg.app/games';
/** Must match GAME_MASTER_DID in packages/web/src/lib/config.ts. */
const EXPECTED_DID = process.env.GAME_MASTER_DID ?? 'did:plc:ew5e3up4h2jf4j263qhdjo4e';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--write');
  const names = args.filter((a) => !a.startsWith('--'));
  const unknown = names.filter((n) => !GAMES.some((g) => g.rkey === n));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown game(s): ${unknown.join(', ')}. Known: ${GAMES.map((g) => g.rkey).join(', ')}.`,
    );
  }
  const selected = names.length > 0 ? GAMES.filter((g) => names.includes(g.rkey)) : GAMES;

  const pdsUrl = process.env.PDS_URL;
  const handle = process.env.BLUESKY_HANDLE;
  const password = process.env.BLUESKY_APP_PASSWORD;
  if (!pdsUrl || !handle || !password) {
    throw new Error('Missing env vars. Set PDS_URL, BLUESKY_HANDLE, and BLUESKY_APP_PASSWORD.');
  }

  const agent = new AtpAgent({ service: pdsUrl });
  await agent.login({ identifier: handle, password });
  const did = agent.session?.did;
  if (!did) throw new Error('Login returned no session.');

  console.log(`\nAuthenticated as ${did}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (pass --write to publish)' : 'LIVE WRITE'}`);
  console.log(`Games: ${selected.map((g) => g.rkey).join(', ')}\n`);

  if (did !== EXPECTED_DID) {
    throw new Error(
      `Refusing to continue: signed in as ${did}, but the web client points its game URIs at ${EXPECTED_DID}.`,
    );
  }

  for (const game of selected) await publishOne(agent, did, game, dryRun);
  console.log(dryRun ? '\nDry run — nothing written.' : '\nDone.');
}

async function publishOne(
  agent: AtpAgent,
  did: string,
  game: GameDefine,
  dryRun: boolean,
): Promise<void> {
  const { rkey, ...fields } = game;

  // Only "no such record" means create — any other failure must stop the run,
  // or a blip would reset an existing record's createdAt.
  const existing = await agent.com.atproto.repo
    .getRecord({ repo: did, collection: COLLECTION, rkey })
    .catch((err: unknown) => {
      if ((err as { error?: string }).error === 'RecordNotFound') return null;
      throw err;
    });
  const prev = existing?.data.value as Record<string, unknown> | undefined;
  const now = new Date().toISOString();

  const record = {
    $type: COLLECTION,
    ...fields,
    url: PLAY_URL,
    publisher: `at://${did}`,
    developer: { name: 'protoimsg', did, url: 'https://protoimsg.app' },
    category: 'browser',
    status: 'live',
    createdAt: typeof prev?.createdAt === 'string' ? prev.createdAt : now,
    ...(prev ? { updatedAt: now } : {}),
  };

  console.log(`${prev ? 'update' : 'create'} at://${did}/${COLLECTION}/${rkey}`);
  console.log(JSON.stringify(record, null, 2));

  if (dryRun) return;
  await agent.com.atproto.repo.putRecord({ repo: did, collection: COLLECTION, rkey, record });
  console.log('  written\n');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

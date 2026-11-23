#!/usr/bin/env node
/**
 * Publish (or update) the `games.atmosphere.define` records for the arcade
 * games in the game master's repo — https://atmosphere.games/docs#define.
 *
 * The web client's opt-in "now playing" status (`games.atmosphere.status`,
 * see packages/web/src/hooks/useGameStatus.ts) points at these records:
 *
 *   at://<game master DID>/games.atmosphere.define/hopper
 *   at://<game master DID>/games.atmosphere.define/hurdles
 *
 * The record keys are part of that contract — don't change them. Re-running
 * is safe: an existing record is updated in place and keeps its createdAt.
 *
 * Nothing is written unless you pass --write: by default it only prints what
 * it would publish. It also refuses to run as any account other than the
 * game master the web client points at (override with GAME_MASTER_DID if you
 * build the client with a different VITE_GAME_MASTER_DID).
 *
 * Usage (from packages/server):
 *   PDS_URL=https://pds.protoimsg.app \
 *   BLUESKY_HANDLE=<game-master-handle> \
 *   BLUESKY_APP_PASSWORD=xxxx-xxxx \
 *   npx tsx scripts/publish-game-defines.ts
 *
 *   ... check the output, then re-run with --write to publish.
 */

import { AtpAgent } from '@atproto/api';

const COLLECTION = 'games.atmosphere.define';
const PLAY_URL = 'https://protoimsg.app/games';

/** Must match GAME_MASTER_DID in packages/web/src/lib/config.ts. */
const EXPECTED_DID = process.env.GAME_MASTER_DID ?? 'did:plc:ew5e3up4h2jf4j263qhdjo4e';

const dryRun = !process.argv.includes('--write');

const pdsUrl = process.env.PDS_URL;
const handle = process.env.BLUESKY_HANDLE;
const password = process.env.BLUESKY_APP_PASSWORD;

if (!pdsUrl || !handle || !password) {
  console.error('Missing env vars. Set PDS_URL, BLUESKY_HANDLE, and BLUESKY_APP_PASSWORD.');
  process.exit(1);
}

// Not a `requires` gate: the open arcade is playable with a ready-made
// character. Your own rpg.actor sprite is what you play as when signed in.
const USES_SPRITE = {
  role: 'character',
  nsid: 'actor.rpg.sprite',
  rkey: 'self',
  purpose: 'Play as your own rpg.actor character',
  acquire: 'https://rpg.actor/generator',
};

const GAMES: Record<string, Record<string, unknown>> = {
  hopper: {
    name: 'Hopper',
    tagline: 'Bounce up through space. Dodge the UFOs and the black holes.',
    description:
      'An endless vertical hopper played as your rpg.actor character. Springs, crumbling and moving platforms, UFOs you can stomp, black holes you cannot. Scores are replayed and verified server-side; reach the top 5 to earn a Jet Pack.',
    tags: ['arcade', 'platformer', 'endless', 'leaderboard'],
    uses: [
      USES_SPRITE,
      {
        role: 'stats',
        nsid: 'actor.rpg.stats',
        rkey: 'self',
        path: 'hopper',
        purpose: 'Your personal best, worst and number of tries',
      },
      {
        role: 'activity',
        nsid: 'games.atmosphere.status',
        rkey: 'any',
        purpose: 'Optional "now playing" status while a session is live',
      },
    ],
  },
  hurdles: {
    name: 'Hurdles',
    tagline: 'Run, jump the flowers, and double-jump the UFOs.',
    description:
      'An endless side-scrolling runner played as your rpg.actor character. Hop the flowers, jump the low UFOs, run under the high ones, and double-jump the combos. Scores are replayed and verified server-side.',
    tags: ['arcade', 'runner', 'endless', 'leaderboard'],
    uses: [
      USES_SPRITE,
      {
        role: 'stats',
        nsid: 'actor.rpg.stats',
        rkey: 'self',
        path: 'hurdles',
        purpose: 'Your personal best, worst and number of tries',
      },
      {
        role: 'activity',
        nsid: 'games.atmosphere.status',
        rkey: 'any',
        purpose: 'Optional "now playing" status while a session is live',
      },
    ],
  },
};

async function main() {
  const agent = new AtpAgent({ service: pdsUrl! });
  await agent.login({ identifier: handle!, password: password! });
  const did = agent.session!.did;

  console.log(`\nAuthenticated as ${did}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (pass --write to publish)' : 'LIVE WRITE'}\n`);

  if (did !== EXPECTED_DID) {
    console.error(
      `Refusing to continue: signed in as ${did}, but the web client points its game URIs at ${EXPECTED_DID}.`,
    );
    process.exit(1);
  }

  for (const [rkey, game] of Object.entries(GAMES)) {
    // Only "no such record" means create — any other failure must stop the
    // run, or a blip would reset an existing record's createdAt.
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
      ...game,
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
    if (dryRun) continue;

    await agent.com.atproto.repo.putRecord({ repo: did, collection: COLLECTION, rkey, record });
    console.log('  written\n');
  }

  console.log(dryRun ? '\nDry run — nothing written.' : '\nDone.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

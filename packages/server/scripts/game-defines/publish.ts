/**
 * Shared publisher for the arcade games' `games.atmosphere.define` records
 * (https://atmosphere.games/docs#define). Each game has its own script in this
 * folder (`hopper.ts`, `hurdles.ts`) that describes the game and calls
 * `publishGameDefine`.
 *
 * These are production records: one per game, in the game master's repo, under
 * a stable key. Portals read them to list the games, and the web client's
 * opt-in "now playing" status (`games.atmosphere.status`, see
 * packages/web/src/hooks/useGameStatus.ts) points at them:
 *
 *   at://<game master DID>/games.atmosphere.define/<rkey>
 *
 * The record key is part of that contract — don't change it. Re-running is
 * safe: an existing record is updated in place and keeps its createdAt.
 *
 * Nothing is written unless --write is passed: by default a script only prints
 * what it would publish. It also refuses to run as any account other than the
 * game master the web client points at (override with GAME_MASTER_DID if the
 * client is built with a different VITE_GAME_MASTER_DID).
 */

import { AtpAgent } from '@atproto/api';

const COLLECTION = 'games.atmosphere.define';
const PLAY_URL = 'https://protoimsg.app/games';
/** Must match GAME_MASTER_DID in packages/web/src/lib/config.ts. */
const EXPECTED_DID = process.env.GAME_MASTER_DID ?? 'did:plc:ew5e3up4h2jf4j263qhdjo4e';

/** One entry of a define record's `uses` list. */
export interface RecordUse {
  role: string;
  nsid: string;
  rkey?: string;
  path?: string;
  purpose?: string;
  acquire?: string;
}

/** What a game's own script supplies. Everything else is filled in here. */
export interface GameDefine {
  /** Record key. Stable forever — the status records link to it. */
  rkey: string;
  name: string;
  tagline: string;
  description: string;
  tags: string[];
  uses: RecordUse[];
}

// Not a `requires` gate: the open arcade is playable with a ready-made
// character. Your own rpg.actor sprite is what you play as when signed in.
export const USES_SPRITE: RecordUse = {
  role: 'character',
  nsid: 'actor.rpg.sprite',
  rkey: 'self',
  purpose: 'Play as your own rpg.actor character',
  acquire: 'https://rpg.actor/generator',
};

/** The player's personal best / worst / tries, under `path` in their stats record. */
export function usesStats(path: string): RecordUse {
  return {
    role: 'stats',
    nsid: 'actor.rpg.stats',
    rkey: 'self',
    path,
    purpose: 'Your personal best, worst and number of tries',
  };
}

export const USES_STATUS: RecordUse = {
  role: 'activity',
  nsid: 'games.atmosphere.status',
  rkey: 'any',
  purpose: 'Optional "now playing" status while a session is live',
};

async function run(game: GameDefine): Promise<void> {
  const dryRun = !process.argv.includes('--write');
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
  console.log(`Mode: ${dryRun ? 'DRY RUN (pass --write to publish)' : 'LIVE WRITE'}\n`);

  if (did !== EXPECTED_DID) {
    throw new Error(
      `Refusing to continue: signed in as ${did}, but the web client points its game URIs at ${EXPECTED_DID}.`,
    );
  }

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

  if (dryRun) {
    console.log('\nDry run — nothing written.');
    return;
  }
  await agent.com.atproto.repo.putRecord({ repo: did, collection: COLLECTION, rkey, record });
  console.log('\nWritten.');
}

/** Publish (or update) one game's define record. Exits non-zero on failure. */
export function publishGameDefine(game: GameDefine): void {
  run(game).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

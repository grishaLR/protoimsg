#!/usr/bin/env node
/**
 * Give a game's leaderboard gift to everyone on its leaderboards right now.
 *
 * The server only gives the gift at the moment a player newly reaches a
 * board, so players who were already there when a gift was introduced never
 * get it. This catches them up. It writes the same `equipment.rpg.give`
 * records the server does (see src/games/service.ts), to the game master's
 * repo; each player's client accepts the gift the next time they sign in.
 *
 * It also brings every existing give of the item up to date with the gift's
 * current images (see syncImages), whoever it was given to.
 *
 * Nothing is written unless --write is passed: by default it only prints what
 * it would do. Re-running is safe — a player who already has the item is
 * skipped, and a give that is already up to date is left alone.
 *
 * Usage (from packages/server):
 *   PDS_URL=https://pds.protoimsg.app \
 *   BLUESKY_HANDLE=<game-master-handle> \
 *   BLUESKY_APP_PASSWORD=xxxx-xxxx \
 *   npx tsx scripts/gift-leaderboard.ts hurdles            # dry run
 *   npx tsx scripts/gift-leaderboard.ts hurdles --write    # give the gifts
 */

import { AtpAgent } from '@atproto/api';
import {
  createGameService,
  findGive,
  giftItem,
  giveFields,
  GIVE_COLLECTION,
  LEADERBOARD_GIFTS,
  type LeaderboardGift,
} from '../src/games/service.js';

/** Must match GAME_MASTER_DID in packages/web/src/lib/config.ts. */
const EXPECTED_DID = process.env.GAME_MASTER_DID ?? 'did:plc:ew5e3up4h2jf4j263qhdjo4e';

/** Every game keeps one board per difficulty. */
const DIFFICULTIES = ['fast', 'faster'];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--write');
  const games = args.filter((a) => !a.startsWith('--'));
  const known = Object.keys(LEADERBOARD_GIFTS);
  if (games.length === 0) throw new Error(`Name the game(s) to gift. Known: ${known.join(', ')}.`);
  const unknown = games.filter((g) => !known.includes(g));
  if (unknown.length > 0) {
    throw new Error(`No leaderboard gift for: ${unknown.join(', ')}. Known: ${known.join(', ')}.`);
  }

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
  // The web client only looks for gives in the game master's repo, and the
  // gift's images live there — a give from any other account is useless.
  if (did !== EXPECTED_DID) {
    throw new Error(
      `Refusing to continue: signed in as ${did}, but gifts come from ${EXPECTED_DID}.`,
    );
  }
  const service = createGameService(handle, password, pdsUrl, '');
  console.log(`Mode: ${dryRun ? 'DRY RUN (pass --write to give)' : 'LIVE WRITE'}\n`);

  for (const game of games) {
    const gift = LEADERBOARD_GIFTS[game];
    if (!gift) continue;

    const players = new Set<string>();
    for (const difficulty of DIFFICULTIES) {
      const board = await service.getLeaderboard(`${game}_${difficulty}`);
      console.log(`${game} ${difficulty}: ${board.length} on the board`);
      for (const entry of board) if (entry.did) players.add(entry.did);
    }
    // The leaderboard read reports a failure as an empty board, so an empty
    // result cannot be trusted as "nobody to gift".
    if (players.size === 0) {
      throw new Error(`No players found on any ${game} board — the read may have failed.`);
    }

    for (const playerDid of players) {
      if (await findGive(agent, playerDid, gift.item)) {
        console.log(`  skip  ${playerDid} — already has ${gift.item}`);
        continue;
      }
      console.log(`  ${dryRun ? 'would give' : 'give'}  ${gift.item} → ${playerDid}`);
      if (!dryRun) await giftItem(agent, playerDid, gift);
    }

    await syncImages(agent, did, gift, dryRun);
  }
  console.log(dryRun ? '\nDry run — nothing written.' : '\nDone.');
}

/**
 * Bring every existing give of this item up to date with the gift's images:
 * the right sheet and icon, referenced as blobs so the give keeps them in the
 * repo. Covers gives written before a gift had an icon, or with a sheet that
 * no longer exists. Each record keeps its key, recipient and date, so items
 * already accepted from it still point at it.
 */
async function syncImages(
  agent: AtpAgent,
  did: string,
  gift: LeaderboardGift,
  dryRun: boolean,
): Promise<void> {
  const { assetCid, iconCid, asset, icon } = giveFields(gift);
  let cursor: string | undefined;
  do {
    const res = await agent.com.atproto.repo.listRecords({
      repo: did,
      collection: GIVE_COLLECTION,
      limit: 100,
      cursor,
    });
    for (const r of res.data.records) {
      const v = r.value as Record<string, unknown>;
      if (v.item !== gift.item) continue;
      if (v.assetCid === assetCid && v.iconCid === iconCid && v.asset && v.icon) continue;
      const rkey = r.uri.split('/').pop();
      if (!rkey) continue;
      console.log(`  ${dryRun ? 'would update' : 'update'}  images on ${gift.item} give ${rkey}`);
      if (dryRun) continue;
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: GIVE_COLLECTION,
        rkey,
        record: { ...v, assetCid, iconCid, asset, icon },
      });
    }
    cursor = res.data.cursor;
  } while (cursor);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

import { AtpAgent } from '@atproto/api';
import { createLogger } from '../logger.js';

const log = createLogger('games');

const LEADERBOARD_SIZE = 5;
const MASTER_COLLECTION = 'actor.rpg.master';
export const GIVE_COLLECTION = 'equipment.rpg.give';

/** A PNG the game master's repo holds: its CID and size in bytes. */
interface GiftImage {
  cid: string;
  size: number;
}

export interface LeaderboardGift {
  item: string;
  title: string;
  description: string;
  context: string;
  category: string;
  kind: string;
  /** The worn layer: a 3×4 sprite sheet. */
  asset: GiftImage;
  /** The inventory icon. */
  icon: GiftImage;
}

/**
 * The item a player is given the first time they reach a game's leaderboard,
 * keyed by the game's base system. Each mirrors a gift defined on rpg.actor.
 * The images must already be blobs in the game master's repo.
 */
export const LEADERBOARD_GIFTS: Record<string, LeaderboardGift> = {
  hopper: {
    item: 'jet_pack',
    title: 'Jet Pack',
    description: 'Built for those who jump higher than the rest.',
    context: 'Earned by reaching the leaderboard in hopper',
    category: 'hind',
    kind: 'layer',
    asset: { cid: 'bafkreiausggyytkgnfy7mwbj2ztupcogr677svawqjkj4ra45ibmopq2ra', size: 3735 },
    icon: { cid: 'bafkreigg2gdlvrw4cixbyy3aqmhknigvreumnngthfkk7hzah6esalsw2y', size: 10037 },
  },
  hurdles: {
    item: 'hermes_shoes',
    title: 'Hermes Shoes',
    description: 'A gift for top hurdlers!',
    context: 'Earned by reaching the leaderboard in hurdles',
    category: 'feet',
    kind: 'layer',
    asset: { cid: 'bafkreibc4j4o7swl6q36nhzczenqrrqshhsbmhw66xzzcj6y3ksoqhekce', size: 4361 },
    icon: { cid: 'bafkreibye742xeu5jguxh2vg2wq73gr2sgt5csvqjufg3j4rk4qhhzu3he', size: 1959 },
  },
};

function blobRef(image: GiftImage) {
  return { $type: 'blob', ref: { $link: image.cid }, mimeType: 'image/png', size: image.size };
}

/**
 * The fields of a give that describe the gift (everything but who and when).
 * `assetCid` / `iconCid` are what readers look up; the `asset` / `icon` blob
 * references are there so the give itself keeps those images in the repo —
 * a bare CID string does not, and the PDS drops a blob nothing references.
 */
export function giveFields(gift: LeaderboardGift): Record<string, unknown> {
  return {
    item: gift.item,
    title: gift.title,
    description: gift.description,
    context: gift.context,
    category: gift.category,
    kind: gift.kind,
    assetCid: gift.asset.cid,
    iconCid: gift.icon.cid,
    asset: blobRef(gift.asset),
    icon: blobRef(gift.icon),
  };
}

export interface LeaderboardEntry {
  did: string;
  score: number;
  updatedAt: string;
}

export interface GameService {
  /**
   * Record a replayed score. Resolves once the leaderboard (and any gift it
   * earned) is written; `gifted` is true when this run earned the player a
   * new item. Never rejects — a failed write is logged and reports no gift.
   */
  submitScore: (playerDid: string, system: string, score: number) => Promise<{ gifted: boolean }>;
  getLeaderboard: (system: string) => Promise<LeaderboardEntry[]>;
}

// "hopper_fast" → { base: "hopper", difficulty: "fast" }
// "hopper"      → { base: "hopper", difficulty: "default" }
function parseSystem(system: string): { base: string; difficulty: string } {
  const idx = system.indexOf('_');
  if (idx === -1) return { base: system, difficulty: 'default' };
  return { base: system.slice(0, idx), difficulty: system.slice(idx + 1) };
}

function formatSystemName(system: string): string {
  return system.split('_').reverse().join(' ');
}

/**
 * Resolve a DID to its handle via the appview — which works regardless of which
 * PDS hosts the account. (`describeRepo` only works for repos on the bot's own
 * PDS, so it threw for every player hosted elsewhere and the post fell back to
 * a raw DID.) Returns null when there's no verified handle, so callers never
 * print a DID.
 */
async function resolveHandle(agent: AtpAgent, did: string): Promise<string | null> {
  try {
    const res = await agent.app.bsky.actor.getProfile({ actor: did });
    const handle = res.data.handle;
    return handle && handle !== 'handle.invalid' ? handle : null;
  } catch {
    return null;
  }
}

function buildPost(
  text: string,
  mentionMap: Map<string, string>,
): { text: string; facets: unknown[] } {
  const encoder = new TextEncoder();
  const facets: unknown[] = [];
  const mentionRegex = /@([a-zA-Z0-9.-]+)/g;
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    const handle = match[1];
    if (!handle) continue;
    const did = mentionMap.get(handle) ?? null;
    if (!did) continue;
    const byteStart = encoder.encode(text.slice(0, match.index)).length;
    const byteEnd = encoder.encode(text.slice(0, match.index + match[0].length)).length;
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#mention', did }],
    });
  }
  return { text, facets };
}

/** The game master's existing give of `item` to this player, if there is one. */
export async function findGive(
  agent: AtpAgent,
  playerDid: string,
  item: string,
): Promise<{ rkey: string; value: Record<string, unknown> } | null> {
  if (!agent.did) return null;
  let cursor: string | undefined;
  do {
    const res = await agent.com.atproto.repo.listRecords({
      repo: agent.did,
      collection: GIVE_COLLECTION,
      limit: 100,
      cursor,
    });
    for (const r of res.data.records) {
      const v = r.value as Record<string, unknown>;
      if (v.item === item && v.recipient === playerDid) {
        return { rkey: r.uri.split('/').pop() ?? '', value: v };
      }
    }
    cursor = res.data.cursor;
  } while (cursor);
  return null;
}

/**
 * Give `gift` to a player, once: a player who already has it is skipped.
 * Resolves true when a new give was written.
 */
export async function giftItem(
  agent: AtpAgent,
  playerDid: string,
  gift: LeaderboardGift,
): Promise<boolean> {
  if (!agent.did) return false;

  if (await findGive(agent, playerDid, gift.item)) {
    log.info({ playerDid, item: gift.item }, 'Item already gifted — skipping');
    return false;
  }

  await agent.com.atproto.repo.createRecord({
    repo: agent.did,
    collection: GIVE_COLLECTION,
    record: {
      $type: GIVE_COLLECTION,
      ...giveFields(gift),
      recipient: playerDid,
      givenAt: new Date().toISOString(),
    },
  });
  log.info({ playerDid, item: gift.item }, 'Item gifted');
  return true;
}

async function postLeaderboardAnnouncement(
  agent: AtpAgent,
  playerDid: string,
  system: string,
  score: number,
  rank: number,
  bumpedDid: string | null,
  siteUrl: string,
): Promise<void> {
  log.info({ playerDid, system, score, rank, bumpedDid }, 'Posting leaderboard announcement');
  const [playerHandle, bumpedHandle] = await Promise.all([
    resolveHandle(agent, playerDid),
    bumpedDid ? resolveHandle(agent, bumpedDid) : Promise.resolve(null),
  ]);

  const gameName = formatSystemName(system);
  const mentionMap = new Map<string, string>();
  if (playerHandle) mentionMap.set(playerHandle, playerDid);
  if (bumpedDid && bumpedHandle) mentionMap.set(bumpedHandle, bumpedDid);

  // Mention "@handle" only when it resolved — never print a raw DID.
  const playerLabel = playerHandle ? `@${playerHandle}` : 'A new player';
  let text = `🎮 New leaderboard entry — ${gameName}!\n\n${playerLabel} scored ${score}\nNow they're #${rank} on the board!`;
  if (bumpedHandle) text += `\n\nSorry @${bumpedHandle}... You're out!`;
  text += `\n\nPlay at ${siteUrl}`;

  const { text: postText, facets } = buildPost(text, mentionMap);

  await agent.com.atproto.repo.createRecord({
    repo: agent.did ?? '',
    collection: 'app.bsky.feed.post',
    record: {
      $type: 'app.bsky.feed.post',
      text: postText,
      ...(facets.length > 0 ? { facets } : {}),
      createdAt: new Date().toISOString(),
    },
  });
  log.info({ playerDid, system, score, rank }, 'Leaderboard announcement posted successfully');
}

export function createGameService(
  identifier: string,
  password: string,
  pdsUrl: string,
  siteUrl: string,
): GameService {
  let agent: AtpAgent | null = null;

  const getAgent = async (): Promise<AtpAgent | null> => {
    if (agent?.did) return agent;
    try {
      const a = new AtpAgent({ service: pdsUrl });
      await a.login({ identifier, password });
      agent = a;
      log.info({ did: a.did }, 'Game master authenticated');
      return agent;
    } catch (err) {
      agent = null;
      log.error({ err }, 'Game master auth failed');
      return null;
    }
  };

  const getLeaderboard = async (system: string): Promise<LeaderboardEntry[]> => {
    const a = await getAgent();
    if (!a?.did) return [];
    try {
      const all: LeaderboardEntry[] = [];
      let cursor: string | undefined;
      const { base, difficulty } = parseSystem(system);
      do {
        const res = await a.com.atproto.repo.listRecords({
          repo: a.did,
          collection: MASTER_COLLECTION,
          limit: 100,
          cursor,
        });
        for (const r of res.data.records) {
          const v = r.value as Record<string, unknown>;
          if (v.system !== base) continue;
          const diffStats = (v.stats as Record<string, Record<string, number>> | undefined)?.[
            difficulty
          ];
          if (!diffStats) continue;
          all.push({
            did: (v.player as string | undefined) ?? '',
            score: diffStats.best ?? 0,
            updatedAt: (v.updatedAt as string | undefined) ?? '',
          });
        }
        cursor = res.data.cursor;
      } while (cursor);

      const byDid = new Map<string, LeaderboardEntry>();
      for (const entry of all) {
        const prev = byDid.get(entry.did);
        if (!prev || entry.score > prev.score) byDid.set(entry.did, entry);
      }
      return [...byDid.values()].sort((a, b) => b.score - a.score).slice(0, LEADERBOARD_SIZE);
    } catch (err) {
      log.error({ err, system }, 'Failed to read leaderboard');
      return [];
    }
  };

  // One submission per player at a time. Each is a read-modify-write of the
  // player's records, so two at once (the same player finishing runs in two
  // tabs) could both find no gift and write it twice. In-process only: enough
  // while a single server instance writes scores.
  const queues = new Map<string, Promise<unknown>>();
  const submitScore = (playerDid: string, system: string, score: number) => {
    const run = (queues.get(playerDid) ?? Promise.resolve()).then(() =>
      writeScore(playerDid, system, score),
    );
    queues.set(playerDid, run);
    void run.finally(() => {
      if (queues.get(playerDid) === run) queues.delete(playerDid);
    });
    return run;
  };

  const writeScore = async (
    playerDid: string,
    system: string,
    score: number,
  ): Promise<{ gifted: boolean }> => {
    const a = await getAgent();
    if (!a?.did) return { gifted: false };

    const { base, difficulty } = parseSystem(system);
    const now = new Date().toISOString();

    try {
      const oldBoard = await getLeaderboard(system);
      const wasOnBoard = oldBoard.some((e) => e.did === playerDid);
      log.info(
        { playerDid, system, score, wasOnBoard, oldBoardSize: oldBoard.length },
        'submit: board state before write',
      );

      // Collect ALL master records for this player+game — there may be duplicates from old rkey schemes
      type DiffStats = Record<string, number>;
      const matches: { rkey: string; stats: Record<string, DiffStats>; createdAt: string }[] = [];
      let cursor: string | undefined;
      do {
        const res = await a.com.atproto.repo.listRecords({
          repo: a.did,
          collection: MASTER_COLLECTION,
          limit: 100,
          cursor,
        });
        for (const r of res.data.records) {
          const v = r.value as Record<string, unknown>;
          if (v.system === base && v.player === playerDid) {
            matches.push({
              rkey: r.uri.split('/').pop() ?? '',
              stats: (v.stats as Record<string, DiffStats> | undefined) ?? {},
              createdAt: (v.createdAt as string | undefined) ?? now,
            });
          }
        }
        cursor = res.data.cursor;
      } while (cursor);

      // Merge all duplicate records into one (take best scores, sum tries)
      const existingStats: Record<string, DiffStats> = {};
      for (const m of matches) {
        for (const [diff, ds] of Object.entries(m.stats)) {
          const e = existingStats[diff];
          existingStats[diff] = e
            ? {
                best: Math.max(e.best ?? 0, ds.best ?? 0),
                tries: (e.tries ?? 0) + (ds.tries ?? 0),
                worst: Math.min(e.worst ?? ds.worst ?? 0, ds.worst ?? e.worst ?? 0),
              }
            : { ...ds };
        }
      }
      const existingRkey = matches[0]?.rkey ?? null;
      const createdAt = matches[0]?.createdAt ?? now;

      // Delete any extra duplicate records (keep only the first)
      for (const m of matches.slice(1)) {
        void a.com.atproto.repo
          .deleteRecord({ repo: a.did, collection: MASTER_COLLECTION, rkey: m.rkey })
          .catch((err: unknown) => {
            log.warn({ err, rkey: m.rkey }, 'Failed to delete duplicate master record');
          });
      }

      const prev = existingStats[difficulty];
      const updatedDiff = {
        best: Math.max(score, prev?.best ?? 0),
        tries: (prev?.tries ?? 0) + 1,
        worst: prev ? Math.min(score, prev.worst ?? score) : score,
      };

      const record = {
        $type: MASTER_COLLECTION,
        system: base,
        player: playerDid,
        snapshotScope: 'full',
        _meta: { name: base },
        stats: { ...existingStats, [difficulty]: updatedDiff },
        createdAt,
        updatedAt: now,
      };

      if (existingRkey) {
        await a.com.atproto.repo.putRecord({
          repo: a.did,
          collection: MASTER_COLLECTION,
          rkey: existingRkey,
          record,
        });
      } else {
        await a.com.atproto.repo.createRecord({
          repo: a.did,
          collection: MASTER_COLLECTION,
          record,
        });
      }

      if (!wasOnBoard) {
        const newBoard = await getLeaderboard(system);
        const newEntry = newBoard.find((e) => e.did === playerDid);
        log.info(
          { playerDid, system, newBoardSize: newBoard.length, madeBoard: !!newEntry },
          'submit: board state after write',
        );
        // A run that scored nothing can still land on a board with room on
        // it; that is not worth an announcement or a gift.
        if (newEntry && newEntry.score > 0) {
          const rank = newBoard.indexOf(newEntry) + 1;
          const newDids = new Set(newBoard.map((e) => e.did));
          const bumped =
            oldBoard.length >= LEADERBOARD_SIZE
              ? (oldBoard.find((e) => !newDids.has(e.did)) ?? null)
              : null;
          void postLeaderboardAnnouncement(
            a,
            playerDid,
            system,
            newEntry.score,
            rank,
            bumped?.did ?? null,
            siteUrl,
          ).catch((err: unknown) => {
            log.error({ err, playerDid, system }, 'Failed to post leaderboard announcement');
          });
          const gift = LEADERBOARD_GIFTS[base];
          if (gift) {
            const gifted = await giftItem(a, playerDid, gift).catch((err: unknown) => {
              log.error({ err, playerDid, item: gift.item }, 'Failed to gift item');
              return false;
            });
            return { gifted };
          }
        }
      }
    } catch (err) {
      agent = null;
      log.error({ err, playerDid, system }, 'Failed to write score record');
    }
    return { gifted: false };
  };

  return { submitScore, getLeaderboard };
}

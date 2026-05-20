import { AtpAgent } from '@atproto/api';
import { createLogger } from '../logger.js';

const log = createLogger('games');

const LEADERBOARD_SIZE = 5;
const MASTER_COLLECTION = 'actor.rpg.master';
const GIVE_COLLECTION = 'equipment.rpg.give';

const JETPACK_GIFT = {
  item: 'jet_pack',
  title: 'Jet Pack',
  description: 'Built for those who jump higher than the rest.',
  context: 'Earned by reaching the leaderboard in hopper',
  category: 'hind',
  kind: 'layer',
  assetCid: 'bafkreihglyimgjcbe2sykhjismvtgrydarkk6ff2rv6wlgv4geu54ehnpm',
} as const;

export interface LeaderboardEntry {
  did: string;
  score: number;
  updatedAt: string;
}

export interface GameService {
  submitScore: (playerDid: string, system: string, score: number) => Promise<void>;
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

async function resolveHandle(agent: AtpAgent, did: string): Promise<string> {
  try {
    const res = await agent.com.atproto.repo.describeRepo({ repo: did });
    return res.data.handle;
  } catch {
    return did;
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

async function giftJetpack(agent: AtpAgent, playerDid: string): Promise<void> {
  if (!agent.did) return;

  // Dedup — skip if already gifted
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
      if (v.item === JETPACK_GIFT.item && v.recipient === playerDid) {
        log.info({ playerDid }, 'Jetpack already gifted — skipping');
        return;
      }
    }
    cursor = res.data.cursor;
  } while (cursor);

  await agent.com.atproto.repo.createRecord({
    repo: agent.did,
    collection: GIVE_COLLECTION,
    record: {
      $type: GIVE_COLLECTION,
      ...JETPACK_GIFT,
      recipient: playerDid,
      givenAt: new Date().toISOString(),
    },
  });
  log.info({ playerDid }, 'Jetpack gifted');
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
  const mentionMap = new Map([[playerHandle, playerDid]]);
  if (bumpedDid && bumpedHandle) mentionMap.set(bumpedHandle, bumpedDid);

  let text = `🎮 New leaderboard entry — ${gameName}!\n\n@${playerHandle} scored ${score}\nNow they're #${rank} on the board!`;
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

  const submitScore = async (playerDid: string, system: string, score: number) => {
    const a = await getAgent();
    if (!a?.did) return;

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
        if (newEntry) {
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
          if (base === 'hopper') {
            void giftJetpack(a, playerDid).catch((err: unknown) => {
              log.error({ err, playerDid }, 'Failed to gift jetpack');
            });
          }
        }
      }
    } catch (err) {
      agent = null;
      log.error({ err, playerDid, system }, 'Failed to write score record');
    }
  };

  return { submitScore, getLeaderboard };
}

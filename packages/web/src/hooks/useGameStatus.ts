import { useCallback, useEffect, useRef, useState } from 'react';
import type { Agent } from '@atproto/api';
import { GAME_MASTER_DID } from '../lib/config';
import { useAuth } from './useAuth';

/**
 * Live player status — `games.atmosphere.status` (https://atmosphere.games/docs#status).
 *
 * While someone is playing, a single record in THEIR OWN repo says which game
 * they are in, so portals and social clients can show "now playing". The
 * lexicon's rules, and how this hook meets them:
 *
 *  - Consent: publishing is OFF until the player turns it on (the checkbox on
 *    each game's start screen). The choice is remembered per account, never
 *    per browser, so one person's yes is never applied to the next person to
 *    sign in here. The record is public, so it is never written for someone
 *    who has not asked for it, and never in practice mode.
 *  - Permission: the session must hold the `repo:games.atmosphere.status`
 *    scope. Sessions from before that scope existed don't, so turning sharing
 *    on asks the account for it (the same re-consent flow the town uses).
 *  - One record per active game per account, TID key, reused for the session:
 *    a leftover record of ours for the same game is adopted instead of adding
 *    a second one.
 *  - `staleAt` is refreshed every few minutes while play continues; consumers
 *    treat the record as abandoned once it passes.
 *  - Nothing lingers: the record is deleted when the game closes, when the
 *    player turns sharing off, and after a stretch with no run in progress.
 *    If that delete could not run (closed tab, crash, sign-out), the next
 *    visit to the game sweeps the leftover up before doing anything else.
 *  - We only ever update or delete records whose `via` is ours.
 */

export type StatusGame = 'hopper' | 'hurdles';

const COLLECTION = 'games.atmosphere.status';
const DEFINE_COLLECTION = 'games.atmosphere.define';
const SCOPE = `repo:${COLLECTION}`;
/** Identifies records this client manages. */
const VIA = 'protoimsg.app';
const PLAY_URL = 'https://protoimsg.app/games';
/** Per-account: the player's choice to share. */
const CONSENT_KEY = 'protoimsg:games:share-status:';
/** Per-account + game: a record of ours may still be in the repo. */
const LIVE_KEY = 'protoimsg:games:status-live:';

/** How often a live status is refreshed. The lexicon asks for every 5–15 minutes. */
const REFRESH_MS = 5 * 60 * 1000;
/** How far ahead `staleAt` is set — comfortably more than one refresh interval. */
const STALE_AFTER_MS = 12 * 60 * 1000;
/** With no run in progress for this long the session is over: the status is removed. */
const IDLE_MS = 10 * 60 * 1000;

const GAME_INFO: Record<StatusGame, { title: string; description: string }> = {
  hopper: {
    title: 'Hopper',
    description: 'Bounce up through space. Dodge the UFOs and the black holes.',
  },
  hurdles: {
    title: 'Hurdles',
    description: 'Run, jump the flowers, and double-jump the UFOs.',
  },
};

/**
 * AT-URI of a game's `games.atmosphere.define` record. They live in the game
 * master's repo under a stable key (see `packages/server/scripts/game-defines/`).
 */
export function gameDefineUri(game: StatusGame): string {
  return `at://${GAME_MASTER_DID}/${DEFINE_COLLECTION}/${game}`;
}

/** This session may write the status record. */
function canWriteStatus(grantedScopes: readonly string[]): boolean {
  return grantedScopes.some((s) => s === SCOPE || s.startsWith(`${SCOPE}?`));
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(key, 'true');
    else localStorage.removeItem(key);
  } catch {
    /* private mode — the flag just won't be remembered */
  }
}

function rkeyOf(uri: string): string {
  return uri.split('/').pop() ?? '';
}

/** Record keys of every status of ours for this game that is in the repo. */
async function findOwnStatuses(agent: Agent, did: string, gameUri: string): Promise<string[]> {
  const res = await agent.com.atproto.repo.listRecords({
    repo: did,
    collection: COLLECTION,
    limit: 100,
  });
  const rkeys: string[] = [];
  for (const r of res.data.records) {
    const v = r.value as Record<string, unknown>;
    if (v.via === VIA && v.game === gameUri) rkeys.push(rkeyOf(r.uri));
  }
  return rkeys;
}

interface Session {
  rkey: string;
  createdAt: string;
}

/**
 * Exactly what the consent checkbox describes: which game, which mode, and
 * that it is being played now. No scores, no progress.
 */
function buildRecord(
  game: StatusGame,
  difficulty: string,
  createdAt: string,
): Record<string, unknown> {
  const info = GAME_INFO[game];
  return {
    $type: COLLECTION,
    game: gameDefineUri(game),
    state: `${difficulty === 'faster' ? 'Faster' : 'Fast'} mode`,
    embed: {
      $type: 'app.bsky.embed.external',
      external: { uri: PLAY_URL, title: info.title, description: info.description },
    },
    createdAt,
    staleAt: new Date(Date.now() + STALE_AFTER_MS).toISOString(),
    via: VIA,
  };
}

export interface GameStatusControls {
  /** Whether a status can be published at all here (signed in, not practice). */
  available: boolean;
  /** Sharing is on: the player chose it and the session is allowed to write it. */
  shareStatus: boolean;
  /** Turning sharing on will first ask the account for permission (leaves the page). */
  needsPermission: boolean;
  setShareStatus: (on: boolean) => void;
  /** Call when a run starts (first play and every retry). */
  markPlaying: () => void;
  /** Call when a run ends. */
  markRunEnded: () => void;
}

export function useGameStatus(
  game: StatusGame,
  difficulty: string,
  practiceMode: boolean | undefined,
): GameStatusControls {
  const { agent, did, grantedScopes, requestScopes } = useAuth();
  const available = !practiceMode && !!agent && !!did;
  const hasScope = canWriteStatus(grantedScopes);

  // Consent belongs to the account. Re-read it whenever the account changes.
  const consentKey = did ? CONSENT_KEY + did : null;
  const [consent, setConsent] = useState<{ key: string | null; on: boolean }>(() => ({
    key: consentKey,
    on: consentKey ? readFlag(consentKey) : false,
  }));
  if (consent.key !== consentKey) {
    setConsent({ key: consentKey, on: consentKey ? readFlag(consentKey) : false });
  }
  const consented = consent.key === consentKey && consent.on;
  const enabled = available && hasScope && consented;

  const sessionRef = useRef<Session | null>(null);
  const playingRef = useRef(false);
  const lastActiveRef = useRef(0);
  // Every PDS write goes through this chain, so a publish and a remove can
  // never race each other into leaving a record behind.
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  const enqueue = useCallback((op: () => Promise<void>) => {
    chainRef.current = chainRef.current.then(op).catch(() => {
      /* status is best-effort — never get in the way of the game */
    });
  }, []);

  const publish = useCallback(
    (a: Agent, repo: string) => {
      enqueue(async () => {
        const liveKey = `${LIVE_KEY}${repo}:${game}`;
        const existing = sessionRef.current;
        if (existing) {
          await a.com.atproto.repo.putRecord({
            repo,
            collection: COLLECTION,
            rkey: existing.rkey,
            record: buildRecord(game, difficulty, existing.createdAt),
          });
          return;
        }
        const createdAt = new Date().toISOString();
        const record = buildRecord(game, difficulty, createdAt);
        // Marked before the write: if the tab dies mid-request the next visit
        // still knows there may be something to clean up.
        writeFlag(liveKey, true);
        const [leftover, ...extras] = await findOwnStatuses(a, repo, gameDefineUri(game));
        for (const rkey of extras) {
          await a.com.atproto.repo.deleteRecord({ repo, collection: COLLECTION, rkey });
        }
        if (leftover) {
          await a.com.atproto.repo.putRecord({
            repo,
            collection: COLLECTION,
            rkey: leftover,
            record,
          });
          sessionRef.current = { rkey: leftover, createdAt };
        } else {
          const res = await a.com.atproto.repo.createRecord({
            repo,
            collection: COLLECTION,
            record,
          });
          sessionRef.current = { rkey: rkeyOf(res.data.uri), createdAt };
        }
      });
    },
    [enqueue, game, difficulty],
  );

  /**
   * Delete every status of ours for this game — the live one and any leftover
   * from a session that never got to clean up. The "may be live" marker is
   * only cleared once the repo is known to be clean, so a failed delete is
   * retried on the next visit.
   */
  const removeAll = useCallback(
    (a: Agent, repo: string) => {
      enqueue(async () => {
        const liveKey = `${LIVE_KEY}${repo}:${game}`;
        sessionRef.current = null;
        if (!readFlag(liveKey)) return;
        const rkeys = await findOwnStatuses(a, repo, gameDefineUri(game));
        for (const rkey of rkeys) {
          await a.com.atproto.repo.deleteRecord({ repo, collection: COLLECTION, rkey });
        }
        writeFlag(liveKey, false);
      });
    },
    [enqueue, game],
  );

  // Arriving at the game: clear out anything a previous session left behind
  // (closed tab, crash, sign-out) — whether or not sharing is on now. Skipped
  // without a network call unless a record of ours may actually be there.
  useEffect(() => {
    if (!available || !hasScope || !did) return;
    removeAll(agent, did);
  }, [available, hasScope, agent, did, removeAll]);

  // While sharing: keep the status fresh, drop it once the player goes idle,
  // and remove it when the game closes or the player turns sharing off.
  useEffect(() => {
    if (!enabled || !did) return;
    const timer = setInterval(() => {
      if (!sessionRef.current) return;
      const idle = !playingRef.current && Date.now() - lastActiveRef.current > IDLE_MS;
      if (idle) removeAll(agent, did);
      else publish(agent, did);
    }, REFRESH_MS);
    return () => {
      clearInterval(timer);
      removeAll(agent, did);
    };
  }, [enabled, agent, did, publish, removeAll]);

  const markPlaying = useCallback(() => {
    playingRef.current = true;
    lastActiveRef.current = Date.now();
    if (!enabled || !did) return;
    if (!sessionRef.current) publish(agent, did);
  }, [enabled, agent, did, publish]);

  const markRunEnded = useCallback(() => {
    playingRef.current = false;
    lastActiveRef.current = Date.now();
  }, []);

  const setShareStatus = useCallback(
    (on: boolean) => {
      if (!consentKey) return;
      writeFlag(consentKey, on);
      setConsent({ key: consentKey, on });
      // An older session can't write the record yet: ask the account for the
      // permission. This leaves for the account's consent screen and comes
      // back signed in with it; declining there leaves sharing off.
      if (on && !hasScope) {
        void requestScopes().catch(() => {
          writeFlag(consentKey, false);
          setConsent({ key: consentKey, on: false });
        });
      }
    },
    [consentKey, hasScope, requestScopes],
  );

  return {
    available,
    shareStatus: enabled,
    needsPermission: available && !hasScope,
    setShareStatus,
    markPlaying,
    markRunEnded,
  };
}

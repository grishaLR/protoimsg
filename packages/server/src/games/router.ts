import { Router } from 'express';
import type { RequestHandler } from 'express';
import {
  simulate,
  simulateHurdles,
  MAX_TICKS,
  type HopperDifficulty,
  type HopperInputLog,
  type HurdlesDifficulty,
  type HurdlesInputLog,
} from '@protoimsg/game-sim';
import { createLogger } from '../logger.js';
import type { GameService } from './service.js';
import type { RunStore } from './run-store.js';

const log = createLogger('games');

const VALID_SYSTEM = /^[a-z_]{1,32}$/;
// Every game that can be started + scored. Each one has a deterministic sim in
// @protoimsg/game-sim that the server replays to compute the score itself.
const PLAYABLE_SYSTEM = /^(hopper|hurdles)_(fast|faster)$/;
const MAX_INPUT_EVENTS = 20000;
const FRAME_MS = 1000 / 60;
// A genuine run is rendered at ~60fps, so wall-clock time can't be much less
// than ticks/60. The 0.8 factor absorbs timing jitter; anything faster means
// the input log was fabricated and submitted without actually being played.
const MIN_TIME_FACTOR = 0.8;

/** Validate + normalize an untrusted hopper input log from the request body. */
function parseHopperLog(v: unknown): HopperInputLog | null {
  if (!Array.isArray(v) || v.length > MAX_INPUT_EVENTS) return null;
  const out: HopperInputLog = [];
  let lastT = -1;
  for (const e of v) {
    if (typeof e !== 'object' || e === null) return null;
    const { t, l, r } = e as Record<string, unknown>;
    if (typeof t !== 'number' || !Number.isInteger(t) || t < lastT || t > MAX_TICKS) return null;
    if (typeof l !== 'boolean' || typeof r !== 'boolean') return null;
    out.push({ t, l, r });
    lastT = t;
  }
  return out;
}

/**
 * Validate + normalize an untrusted hurdles input log: the ticks at which jump
 * was pressed, strictly ascending (at most one press per tick).
 */
function parseHurdlesLog(v: unknown): HurdlesInputLog | null {
  if (!Array.isArray(v) || v.length > MAX_INPUT_EVENTS) return null;
  const out: HurdlesInputLog = [];
  let lastT = -1;
  for (const t of v) {
    if (typeof t !== 'number' || !Number.isInteger(t) || t <= lastT || t > MAX_TICKS) return null;
    out.push(t);
    lastT = t;
  }
  return out;
}

interface Replay {
  score: number;
  ticks: number;
  died: boolean;
}

/**
 * Validate an untrusted input log against the game `system` names. Returns a
 * function that replays it (up to `maxTicks`), or null when the log isn't a
 * valid log for that game.
 */
function prepareReplay(
  system: string,
  seed: number,
  inputLog: unknown,
): ((maxTicks: number) => Replay) | null {
  const match = PLAYABLE_SYSTEM.exec(system);
  if (!match) return null;
  if (match[1] === 'hurdles') {
    const jumps = parseHurdlesLog(inputLog);
    if (!jumps) return null;
    const difficulty = match[2] as HurdlesDifficulty;
    return (maxTicks) => simulateHurdles(seed, difficulty, jumps, maxTicks);
  }
  const events = parseHopperLog(inputLog);
  if (!events) return null;
  const difficulty = match[2] as HopperDifficulty;
  return (maxTicks) => simulate(seed, difficulty, events, maxTicks);
}

export function gamesRouter(
  gameService: GameService,
  runStore: RunStore,
  requireAuth: RequestHandler,
  rateLimit?: RequestHandler,
): Router {
  const router = Router();
  const limited: RequestHandler[] = rateLimit ? [requireAuth, rateLimit] : [requireAuth];

  // Public — any client can fetch the leaderboard directly.
  router.get('/leaderboard/:system', async (req, res) => {
    const { system } = req.params;
    if (!system || !VALID_SYSTEM.test(system)) {
      res.status(400).json({ error: 'Invalid system' });
      return;
    }
    const entries = await gameService.getLeaderboard(system);
    res.json({ system, entries });
  });

  // Auth — begin a run. The server picks the seed so the client cannot
  // precompute a favourable game offline, and binds it to a single-use runId.
  router.post('/start', ...limited, async (req, res, next) => {
    try {
      const did = req.did;
      if (!did) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { system } = req.body as { system?: unknown };
      if (typeof system !== 'string' || !PLAYABLE_SYSTEM.test(system)) {
        res.status(400).json({ error: 'Invalid system' });
        return;
      }
      const issued = await runStore.create(did, system);
      res.json(issued);
    } catch (err) {
      next(err);
    }
  });

  // Auth — submit a finished run. The server replays the input log through
  // the deterministic sim and trusts only the score it computes itself.
  router.post('/score', ...limited, async (req, res, next) => {
    try {
      const did = req.did;
      if (!did) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { runId, inputLog } = req.body as { runId?: unknown; inputLog?: unknown };
      if (typeof runId !== 'string' || runId.length > 64) {
        res.status(400).json({ error: 'Invalid runId' });
        return;
      }
      // Check everything that can be checked BEFORE spending the ticket, so
      // a bad request (someone else's runId, a log for the wrong game, a
      // malformed log) can't burn a player's run.
      const pending = await runStore.peek(runId);
      if (!pending) {
        res.status(410).json({ error: 'Run expired or already submitted' });
        return;
      }
      if (pending.did !== did) {
        res.status(403).json({ error: 'Run does not belong to this user' });
        return;
      }
      if (!prepareReplay(pending.system, pending.seed, inputLog)) {
        res.status(400).json({ error: 'Invalid inputLog' });
        return;
      }

      // Consuming the ticket is atomic and single-use — a recorded run can
      // never be replayed twice, even under concurrent submissions. Only
      // what consume() returns is trusted from here on.
      const run = await runStore.consume(runId);
      if (!run) {
        res.status(410).json({ error: 'Run expired or already submitted' });
        return;
      }
      const replay = run.did === did ? prepareReplay(run.system, run.seed, inputLog) : null;
      if (!replay) {
        res.status(400).json({ error: 'Invalid run' });
        return;
      }

      // A genuine run can't contain more ticks than the wall-clock time since
      // /start allows, so the replay is capped there. That bounds the CPU a
      // request can cost by the real time its sender waited — a log that
      // never dies can't buy a full-length replay for free.
      const elapsed = Date.now() - run.startedAt;
      const maxTicks = Math.min(MAX_TICKS, Math.ceil(elapsed / (FRAME_MS * MIN_TIME_FACTOR)));
      const result = replay(maxTicks);
      if (!result.died) {
        // Still alive at the cap: either submitted faster than it could have
        // been played, or a fabricated log that never ends. A legitimate run
        // always ends in death.
        log.warn(
          { did, system: run.system, elapsed, maxTicks },
          'rejected run: did not end within the time played',
        );
        res.status(422).json({ error: 'Invalid run' });
        return;
      }

      // Note: replay guarantees the score matches the inputs, and the
      // server-issued seed + time-gate stop instant/offline submission. A
      // determined attacker computing an optimal input log and waiting out
      // the clock remains possible — the accepted ceiling for any
      // client-rendered leaderboard game.
      void gameService.submitScore(did, run.system, result.score);
      res.json({ ok: true, score: result.score });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

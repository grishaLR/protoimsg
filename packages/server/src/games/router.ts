import { Router } from 'express';
import type { RequestHandler } from 'express';
import {
  simulate,
  MAX_TICKS,
  type HopperDifficulty,
  type HopperInputLog,
} from '@protoimsg/game-sim';
import { createLogger } from '../logger.js';
import type { GameService } from './service.js';
import type { RunStore } from './run-store.js';

const log = createLogger('games');

const VALID_SYSTEM = /^[a-z_]{1,32}$/;
const HOPPER_SYSTEM = /^hopper_(fast|faster)$/;
const MAX_INPUT_EVENTS = 20000;
const FRAME_MS = 1000 / 60;
// A genuine run is rendered at ~60fps, so wall-clock time can't be much less
// than ticks/60. The 0.8 factor absorbs timing jitter; anything faster means
// the input log was fabricated and submitted without actually being played.
const MIN_TIME_FACTOR = 0.8;

/** Validate + normalize an untrusted input log from the request body. */
function parseInputLog(v: unknown): HopperInputLog | null {
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
      if (typeof system !== 'string' || !HOPPER_SYSTEM.test(system)) {
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
      const events = parseInputLog(inputLog);
      if (!events) {
        res.status(400).json({ error: 'Invalid inputLog' });
        return;
      }

      // Consuming the ticket is atomic and single-use — a recorded run can
      // never be replayed twice, even under concurrent submissions.
      const run = await runStore.consume(runId);
      if (!run) {
        res.status(410).json({ error: 'Run expired or already submitted' });
        return;
      }
      if (run.did !== did) {
        res.status(403).json({ error: 'Run does not belong to this user' });
        return;
      }

      const match = HOPPER_SYSTEM.exec(run.system);
      if (!match || !match[1]) {
        res.status(400).json({ error: 'Unsupported system' });
        return;
      }
      const difficulty = match[1] as HopperDifficulty;

      const result = simulate(run.seed, difficulty, events);
      if (!result.died) {
        // A legitimate run always ends in death; hitting the tick cap alive
        // means the log was fabricated.
        log.warn({ did, system: run.system }, 'rejected run: did not terminate');
        res.status(422).json({ error: 'Invalid run' });
        return;
      }

      const elapsed = Date.now() - run.startedAt;
      const minMs = result.ticks * FRAME_MS * MIN_TIME_FACTOR;
      if (elapsed < minMs) {
        log.warn(
          { did, system: run.system, elapsed, minMs, ticks: result.ticks },
          'rejected run: submitted faster than real-time',
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

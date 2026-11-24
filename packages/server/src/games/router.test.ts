import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { simulate, simulateHurdles } from '@protoimsg/game-sim';
import { gamesRouter } from './router.js';
import { RunStore } from './run-store.js';
import type { GameService } from './service.js';

// These lock the anti-cheat contract of the games endpoints: the score that
// reaches the leaderboard is the one the server replays, never one a client
// sent, and a run can't be submitted twice, by someone else, or faster than it
// could have been played.

const DID = 'did:plc:player';

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] };
}

/** The final handler of a route — past the auth middleware. */
function handlerFor(router: ReturnType<typeof gamesRouter>, method: string, path: string): Handler {
  for (const layer of router.stack as RouteLayer[]) {
    const route = layer.route;
    if (route && route.path === path && route.methods[method]) {
      return route.stack[route.stack.length - 1]?.handle as Handler;
    }
  }
  throw new Error(`${method} ${path} handler not found`);
}

async function call(handler: Handler, body: unknown, did: string | undefined = DID) {
  const json = vi.fn();
  const status = vi.fn().mockReturnThis();
  const res = { json, status } as unknown as Response;
  const next = vi.fn();
  await handler({ did, body } as unknown as Request, res, next);
  expect(next).not.toHaveBeenCalled();
  const statusCall = status.mock.calls[0] as unknown[] | undefined;
  const jsonCall = json.mock.calls[0] as unknown[] | undefined;
  return {
    status: (statusCall?.[0] as number | undefined) ?? 200,
    body: (jsonCall?.[0] ?? {}) as Record<string, unknown>,
  };
}

function setup() {
  const submitScore = vi.fn<GameService['submitScore']>().mockResolvedValue({ gifted: false });
  const getLeaderboard = vi.fn<GameService['getLeaderboard']>().mockResolvedValue([]);
  const requireAuth: RequestHandler = (_req, _res, next) => {
    next();
  };
  const router = gamesRouter({ submitScore, getLeaderboard }, new RunStore(null), requireAuth);
  return {
    submitScore,
    start: handlerFor(router, 'post', '/start'),
    score: handlerFor(router, 'post', '/score'),
  };
}

async function startRun(start: Handler, system: string, did: string = DID) {
  const res = await call(start, { system }, did);
  expect(res.status).toBe(200);
  return res.body as { runId: string; seed: number };
}

const HURDLES_JUMPS = [158, 253, 352];
const HOPPER_LOG = [
  { t: 30, l: false, r: true },
  { t: 90, l: false, r: false },
];

describe('gamesRouter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('POST /start', () => {
    it('issues a run for every playable game', async () => {
      const { start } = setup();
      for (const system of ['hopper_fast', 'hopper_faster', 'hurdles_fast', 'hurdles_faster']) {
        const run = await startRun(start, system);
        expect(typeof run.runId).toBe('string');
        expect(Number.isInteger(run.seed)).toBe(true);
      }
    });

    it('rejects unknown systems', async () => {
      const { start } = setup();
      for (const system of ['hurdles', 'hurdles_slow', 'chess_fast', 42, undefined]) {
        expect((await call(start, { system })).status).toBe(400);
      }
    });
  });

  describe('POST /score', () => {
    it('writes the score the server replays for a hurdles run', async () => {
      const { start, score, submitScore } = setup();
      const run = await startRun(start, 'hurdles_fast');
      const expected = simulateHurdles(run.seed, 'fast', HURDLES_JUMPS);
      expect(expected.died).toBe(true);
      vi.advanceTimersByTime(expected.ticks * 17);

      const res = await call(score, { runId: run.runId, inputLog: HURDLES_JUMPS });

      expect(res).toEqual({
        status: 200,
        body: { ok: true, score: expected.score, gifted: false },
      });
      expect(submitScore).toHaveBeenCalledExactlyOnceWith(DID, 'hurdles_fast', expected.score);
    });

    it('tells the client when the run earned a gift', async () => {
      const { start, score, submitScore } = setup();
      submitScore.mockResolvedValue({ gifted: true });
      const run = await startRun(start, 'hurdles_fast');
      const expected = simulateHurdles(run.seed, 'fast', HURDLES_JUMPS);
      vi.advanceTimersByTime(expected.ticks * 17);

      const res = await call(score, { runId: run.runId, inputLog: HURDLES_JUMPS });

      expect(res.body.gifted).toBe(true);
    });

    it('replays hurdles with the difficulty the run was started with', async () => {
      const { start, score, submitScore } = setup();
      const run = await startRun(start, 'hurdles_faster');
      const expected = simulateHurdles(run.seed, 'faster', []);
      vi.advanceTimersByTime(expected.ticks * 17);

      const res = await call(score, { runId: run.runId, inputLog: [] });

      expect(res.body.score).toBe(expected.score);
      expect(submitScore).toHaveBeenCalledExactlyOnceWith(DID, 'hurdles_faster', expected.score);
    });

    it('still replays hopper runs', async () => {
      const { start, score, submitScore } = setup();
      const run = await startRun(start, 'hopper_fast');
      const expected = simulate(run.seed, 'fast', HOPPER_LOG);
      vi.advanceTimersByTime(expected.ticks * 17);

      const res = await call(score, { runId: run.runId, inputLog: HOPPER_LOG });

      expect(res).toEqual({
        status: 200,
        body: { ok: true, score: expected.score, gifted: false },
      });
      expect(submitScore).toHaveBeenCalledExactlyOnceWith(DID, 'hopper_fast', expected.score);
    });

    it('ignores a client-supplied score', async () => {
      const { start, score, submitScore } = setup();
      const run = await startRun(start, 'hurdles_fast');
      const expected = simulateHurdles(run.seed, 'fast', []);
      vi.advanceTimersByTime(expected.ticks * 17);

      await call(score, { runId: run.runId, inputLog: [], score: 999999, system: 'hurdles_fast' });

      expect(submitScore).toHaveBeenCalledExactlyOnceWith(DID, 'hurdles_fast', expected.score);
    });

    it('rejects a run submitted faster than it could be played', async () => {
      const { start, score, submitScore } = setup();
      const run = await startRun(start, 'hurdles_fast');
      vi.advanceTimersByTime(500);

      const res = await call(score, { runId: run.runId, inputLog: HURDLES_JUMPS });

      expect(res.status).toBe(422);
      expect(submitScore).not.toHaveBeenCalled();
    });

    it('accepts a run only once', async () => {
      const { start, score, submitScore } = setup();
      const run = await startRun(start, 'hurdles_fast');
      vi.advanceTimersByTime(60_000);

      expect((await call(score, { runId: run.runId, inputLog: [] })).status).toBe(200);
      expect((await call(score, { runId: run.runId, inputLog: [] })).status).toBe(410);
      expect(submitScore).toHaveBeenCalledTimes(1);
    });

    it("rejects a run submitted from someone else's account", async () => {
      const { start, score, submitScore } = setup();
      const run = await startRun(start, 'hurdles_fast');
      vi.advanceTimersByTime(60_000);

      const res = await call(score, { runId: run.runId, inputLog: [] }, 'did:plc:someone-else');

      expect(res.status).toBe(403);
      expect(submitScore).not.toHaveBeenCalled();
    });

    it('rejects malformed hurdles logs without spending the run', async () => {
      const { start, score, submitScore } = setup();
      const run = await startRun(start, 'hurdles_fast');
      vi.advanceTimersByTime(60_000);

      const bad: unknown[] = [
        undefined,
        'nope',
        [1.5],
        [-1],
        [10, 10], // two presses in one tick
        [20, 10], // out of order
        [1e9], // past the tick cap
        [10, { t: 20, l: true, r: false }], // mixed shapes
      ];
      for (const inputLog of bad) {
        expect((await call(score, { runId: run.runId, inputLog })).status).toBe(400);
      }
      expect(submitScore).not.toHaveBeenCalled();
      // The ticket survived all of that.
      expect((await call(score, { runId: run.runId, inputLog: [] })).status).toBe(200);
    });

    it("rejects another game's input log for the run", async () => {
      const { start, score, submitScore } = setup();
      const hurdles = await startRun(start, 'hurdles_fast');
      const hopper = await startRun(start, 'hopper_fast');
      vi.advanceTimersByTime(60_000);

      expect((await call(score, { runId: hurdles.runId, inputLog: HOPPER_LOG })).status).toBe(400);
      expect((await call(score, { runId: hopper.runId, inputLog: HURDLES_JUMPS })).status).toBe(
        400,
      );
      expect(submitScore).not.toHaveBeenCalled();
    });

    it('does not spend a run on a bad submission', async () => {
      const { start, score, submitScore } = setup();
      const hopper = await startRun(start, 'hopper_fast');
      vi.advanceTimersByTime(60_000);

      // Wrong game's log, then someone else's account — neither burns the ticket.
      expect((await call(score, { runId: hopper.runId, inputLog: HURDLES_JUMPS })).status).toBe(
        400,
      );
      expect(
        (await call(score, { runId: hopper.runId, inputLog: HOPPER_LOG }, 'did:plc:someone-else'))
          .status,
      ).toBe(403);
      expect(submitScore).not.toHaveBeenCalled();

      expect((await call(score, { runId: hopper.runId, inputLog: HOPPER_LOG })).status).toBe(200);
      expect(submitScore).toHaveBeenCalledTimes(1);
    });

    it('rejects malformed hopper logs', async () => {
      const { start, score } = setup();
      const run = await startRun(start, 'hopper_fast');
      vi.advanceTimersByTime(60_000);
      const bad: unknown[] = [
        [{ t: 1, l: 'yes', r: false }],
        [
          { t: 5, l: true, r: false },
          { t: 2, l: false, r: false },
        ],
        [{ t: 1.5, l: true, r: false }],
        [null],
      ];
      for (const inputLog of bad) {
        expect((await call(score, { runId: run.runId, inputLog })).status).toBe(400);
      }
    });

    it('rejects a log that never ends, without replaying past the time played', async () => {
      const { start, score, submitScore } = setup();
      // With no input the hopper bounces on the start platform forever.
      const run = await startRun(start, 'hopper_fast');
      expect(simulate(run.seed, 'fast', [], 5000).died).toBe(false);
      vi.advanceTimersByTime(10_000);

      const res = await call(score, { runId: run.runId, inputLog: [] });

      expect(res.status).toBe(422);
      expect(submitScore).not.toHaveBeenCalled();
    });

    it('applies the time gate at its boundary', async () => {
      const { start, score } = setup();
      const ticks = (seed: number) => simulateHurdles(seed, 'fast', []).ticks;
      const minMs = (t: number) => (t * (1000 / 60) * 8) / 10;

      const early = await startRun(start, 'hurdles_fast');
      vi.advanceTimersByTime(Math.floor(minMs(ticks(early.seed))) - 20);
      expect((await call(score, { runId: early.runId, inputLog: [] })).status).toBe(422);

      const onTime = await startRun(start, 'hurdles_fast');
      vi.advanceTimersByTime(Math.ceil(minMs(ticks(onTime.seed))) + 20);
      expect((await call(score, { runId: onTime.runId, inputLog: [] })).status).toBe(200);
    });

    it('requires a signed-in player', async () => {
      const { start, score } = setup();
      const noDid = async (h: Handler, body: unknown) => {
        const status = vi.fn().mockReturnThis();
        const res = { json: vi.fn(), status } as unknown as Response;
        await h({ body } as unknown as Request, res, vi.fn());
        return (status.mock.calls[0] as unknown[] | undefined)?.[0];
      };
      expect(await noDid(start, { system: 'hurdles_fast' })).toBe(401);
      expect(await noDid(score, { runId: 'x', inputLog: [] })).toBe(401);
    });
  });
});

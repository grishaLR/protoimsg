import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { GameService } from './service.js';

const VALID_SYSTEM = /^[a-z_]{1,32}$/;

export function gamesRouter(gameService: GameService, requireAuth: RequestHandler): Router {
  const router = Router();

  // Public — any client can fetch the leaderboard directly
  router.get('/leaderboard/:system', async (req, res) => {
    const { system } = req.params;
    if (!system || !VALID_SYSTEM.test(system)) {
      res.status(400).json({ error: 'Invalid system' });
      return;
    }
    const entries = await gameService.getLeaderboard(system);
    res.json({ system, entries });
  });

  // Auth required — submits a score on behalf of the authenticated user
  router.post('/score', requireAuth, (req, res) => {
    const did = req.did;
    if (!did) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { system, score } = req.body as { system?: unknown; score?: unknown };
    if (typeof system !== 'string' || !VALID_SYSTEM.test(system)) {
      res.status(400).json({ error: 'Invalid system' });
      return;
    }
    if (typeof score !== 'number' || score < 0 || !Number.isFinite(score)) {
      res.status(400).json({ error: 'Invalid score' });
      return;
    }
    void gameService.submitScore(did, system, Math.floor(score));
    res.json({ ok: true });
  });

  return router;
}

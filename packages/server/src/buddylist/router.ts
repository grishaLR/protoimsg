import { Router } from 'express';
import type { Sql } from '../db/client.js';
import { getBuddyList } from './queries.js';

export function buddylistRouter(sql: Sql): Router {
  const router = Router();

  // GET /api/buddylist/:did
  router.get('/:did', async (req, res, next) => {
    try {
      const row = await getBuddyList(sql, req.params.did);
      if (!row) {
        res.json({ groups: [] });
        return;
      }
      res.json({ groups: row.groups });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

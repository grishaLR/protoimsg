import { Router } from 'express';
import { z } from 'zod';
import { recordModAction } from './queries.js';
import type { Sql } from '../db/client.js';
import { isValidDid } from '../auth/verify.js';

const reportBodySchema = z.object({
  subjectDid: z.string().refine(isValidDid, 'Invalid DID format'),
  reason: z.string().optional(),
});

export function moderationRouter(sql: Sql): Router {
  const router = Router();

  // POST /api/rooms/:id/report
  router.post('/:id/report', async (req, res, next) => {
    try {
      const parsed = reportBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request body', details: parsed.error.issues });
        return;
      }

      await recordModAction(sql, {
        roomId: req.params.id,
        actorDid: req.did ?? '',
        subjectDid: parsed.data.subjectDid,
        action: 'report',
        reason: parsed.data.reason,
      });

      res.status(201).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

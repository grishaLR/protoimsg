import { Router } from 'express';
import { getRoomMessages } from './service.js';
import type { Sql } from '../db/client.js';

export function messagesRouter(sql: Sql): Router {
  const router = Router();

  // GET /api/rooms/:id/messages — get message history for a room
  router.get('/:id/messages', async (req, res, next) => {
    try {
      const messages = await getRoomMessages(sql, req.params.id, {
        limit: Number(req.query.limit) || 50,
        before: typeof req.query.before === 'string' ? req.query.before : undefined,
      });
      res.json({ messages });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

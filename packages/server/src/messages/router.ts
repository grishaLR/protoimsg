import { Router } from 'express';
import { getRoomMessages } from './service.js';
import { createDb } from '../db/client.js';
import { loadConfig } from '../config.js';

export function messagesRouter(): Router {
  const router = Router();
  const config = loadConfig();
  const sql = createDb(config.DATABASE_URL);

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

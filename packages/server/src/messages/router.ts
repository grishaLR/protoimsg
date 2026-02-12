import { Router } from 'express';
import { LIMITS } from '@protoimsg/shared';
import { getRoomMessages, getThreadMessagesByRoot, getReplyCounts } from './service.js';
import type { Sql } from '../db/client.js';

export function messagesRouter(sql: Sql): Router {
  const router = Router();

  // GET /api/rooms/:id/messages — get message history for a room (with reply counts)
  router.get('/:id/messages', async (req, res, next) => {
    try {
      const messages = await getRoomMessages(sql, req.params.id, {
        limit: Math.min(
          Math.max(Number(req.query.limit) || LIMITS.defaultPageSize, 1),
          LIMITS.maxPageSize,
        ),
        before: typeof req.query.before === 'string' ? req.query.before : undefined,
      });

      const replyCounts = await getReplyCounts(sql, messages);

      res.json({ messages, replyCounts });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/rooms/:id/threads?root=<at-uri> — get all messages in a thread
  router.get('/:id/threads', async (req, res, next) => {
    try {
      const rootUri = req.query.root;
      if (typeof rootUri !== 'string' || !rootUri.startsWith('at://')) {
        res.status(400).json({ error: 'Missing or invalid "root" query param (expected AT-URI)' });
        return;
      }

      const messages = await getThreadMessagesByRoot(sql, req.params.id, rootUri, {
        limit: Math.min(Math.max(Number(req.query.limit) || 200, 1), 500),
      });

      res.json({ messages });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

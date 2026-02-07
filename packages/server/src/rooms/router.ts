import { Router } from 'express';
import { getRooms, getRoom } from './service.js';
import { createDb } from '../db/client.js';
import { loadConfig } from '../config.js';

export function roomsRouter(): Router {
  const router = Router();
  const config = loadConfig();
  const sql = createDb(config.DATABASE_URL);

  // GET /api/rooms — list public rooms
  router.get('/', async (_req, res, next) => {
    try {
      const rooms = await getRooms(sql, {
        visibility:
          (typeof _req.query.visibility === 'string' ? _req.query.visibility : undefined) ??
          'public',
        limit: Number(_req.query.limit) || 50,
        offset: Number(_req.query.offset) || 0,
      });
      res.json({ rooms });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/rooms/:id — get room by id
  router.get('/:id', async (req, res, next) => {
    try {
      const room = await getRoom(sql, req.params.id);
      if (!room) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }
      res.json({ room });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

import { Router } from 'express';
import { z } from 'zod';
import { LIMITS } from '@protoimsg/shared';
import { getRooms, getRoom } from './service.js';
import type { Sql } from '../db/client.js';

const visibilitySchema = z.enum(['public', 'unlisted']);
const roomListQuerySchema = z.object({
  visibility: visibilitySchema.optional().default('public'),
  limit: z.coerce
    .number()
    .min(1)
    .max(LIMITS.maxPageSize)
    .optional()
    .default(LIMITS.defaultPageSize),
  offset: z.coerce.number().min(0).optional().default(0),
});

export function roomsRouter(sql: Sql): Router {
  const router = Router();

  // GET /api/rooms — list public/unlisted rooms (private rooms never exposed)
  router.get('/', async (req, res, next) => {
    try {
      const parsed = roomListQuerySchema.safeParse({
        visibility: req.query.visibility,
        limit: req.query.limit,
        offset: req.query.offset,
      });
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid query params', details: parsed.error.issues });
        return;
      }
      const { visibility, limit, offset } = parsed.data;
      const rooms = await getRooms(sql, {
        visibility,
        limit,
        offset,
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

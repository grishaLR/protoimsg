import { Router } from 'express';
import { z } from 'zod';
import type { NotificationService } from './service.js';
import { createLogger } from '../logger.js';

const _log = createLogger('notifications');

const RegisterSchema = z.object({
  token: z.string().min(1).max(200),
  platform: z.enum(['ios', 'android']),
});

const UnregisterSchema = z.object({
  token: z.string().min(1).max(200),
});

export function notificationsRouter(notificationService: NotificationService): Router {
  const router = Router();

  // POST /api/device-tokens — register a push token
  router.post('/', async (req, res, next) => {
    try {
      const { token, platform } = RegisterSchema.parse(req.body);
      const did = req.did;
      if (!did) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      await notificationService.registerToken(did, token, platform);
      res.status(201).json({ ok: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid request', details: err.errors });
        return;
      }
      next(err);
    }
  });

  // DELETE /api/device-tokens — unregister a push token
  router.delete('/', async (req, res, next) => {
    try {
      const did = req.did;
      if (!did) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { token } = UnregisterSchema.parse(req.body);
      await notificationService.unregisterToken(did, token);
      res.status(204).end();
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid request', details: err.errors });
        return;
      }
      next(err);
    }
  });

  return router;
}

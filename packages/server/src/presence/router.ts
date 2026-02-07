import { Router } from 'express';
import type { PresenceService } from './service.js';

export function presenceRouter(service: PresenceService): Router {
  const router = Router();

  // GET /api/presence?dids=did1,did2,...
  router.get('/', (req, res) => {
    const didsParam = typeof req.query.dids === 'string' ? req.query.dids : '';
    if (!didsParam) {
      res.status(400).json({ error: 'Missing dids query parameter' });
      return;
    }

    const dids = didsParam.split(',').filter(Boolean).slice(0, 100);
    const presence = service.getBulkPresence(dids);
    res.json({ presence });
  });

  return router;
}

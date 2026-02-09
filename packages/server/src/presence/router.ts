import { Router } from 'express';
import type { PresenceService } from './service.js';
import type { BlockService } from '../moderation/block-service.js';

export function presenceRouter(service: PresenceService, blockService: BlockService): Router {
  const router = Router();

  // GET /api/presence?dids=did1,did2,... — block-filtered so requester doesn't see real status of blocked users
  router.get('/', (req, res) => {
    const didsParam = typeof req.query.dids === 'string' ? req.query.dids : '';
    if (!didsParam) {
      res.status(400).json({ error: 'Missing dids query parameter' });
      return;
    }

    const requesterDid = req.did ?? '';
    const dids = didsParam.split(',').filter(Boolean).slice(0, 100);
    const presence = service
      .getBulkPresence(dids)
      .map((p) =>
        blockService.doesBlock(requesterDid, p.did)
          ? { did: p.did, status: 'offline' as const }
          : p,
      );
    res.json({ presence });
  });

  return router;
}

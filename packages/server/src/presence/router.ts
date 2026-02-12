import { Router } from 'express';
import type { PresenceService } from './service.js';
import type { BlockService } from '../moderation/block-service.js';
import type { Sql } from '../db/client.js';
import { isCommunityMember, isInnerCircle } from '../community/queries.js';
import { resolveVisibleStatus } from './visibility.js';

export function presenceRouter(
  service: PresenceService,
  blockService: BlockService,
  sql: Sql,
): Router {
  const router = Router();

  // GET /api/presence?dids=did1,did2,... — block + visibility filtered
  router.get('/', (req, res) => {
    const didsParam = typeof req.query.dids === 'string' ? req.query.dids : '';
    if (!didsParam) {
      res.status(400).json({ error: 'Missing dids query parameter' });
      return;
    }

    const requesterDid = req.did ?? '';
    const dids = didsParam.split(',').filter(Boolean).slice(0, 100);
    const rawPresence = service.getBulkPresence(dids);

    void Promise.all(
      rawPresence.map(async (p) => {
        // Block filter
        if (blockService.doesBlock(requesterDid, p.did)) {
          return { did: p.did, status: 'offline' as const };
        }
        // Visibility filter — same logic as WS request_community_presence
        const visibility = service.getVisibleTo(p.did);
        if (visibility === 'everyone') return p;

        const member =
          visibility === 'community' || visibility === 'inner-circle'
            ? await isCommunityMember(sql, p.did, requesterDid)
            : false;
        const friend =
          visibility === 'inner-circle' ? await isInnerCircle(sql, p.did, requesterDid) : false;

        const effectiveStatus = resolveVisibleStatus(
          visibility,
          p.status as 'online' | 'away' | 'idle' | 'offline',
          member,
          friend,
        );
        return {
          did: p.did,
          status: effectiveStatus,
          awayMessage: effectiveStatus === 'offline' ? undefined : p.awayMessage,
        };
      }),
    ).then((presence) => {
      res.json({ presence });
    });
  });

  return router;
}

import { Router } from 'express';
import { ERROR_CODES } from '@protoimsg/shared';
import type { PresenceService } from './service.js';
import type { BlockService } from '../moderation/block-service.js';
import type { Sql } from '../db/client.js';
import { batchCheckMembership, batchCheckInnerCircle } from '../community/queries.js';
import { resolveVisibleStatus } from './visibility.js';

export function presenceRouter(
  service: PresenceService,
  blockService: BlockService,
  sql: Sql,
): Router {
  const router = Router();

  // GET /api/presence?dids=did1,did2,... — block + visibility filtered
  router.get('/', (req, res, next) => {
    const didsParam = typeof req.query.dids === 'string' ? req.query.dids : '';
    if (!didsParam) {
      res
        .status(400)
        .json({ error: 'Missing dids query parameter', errorCode: ERROR_CODES.INVALID_INPUT });
      return;
    }

    const requesterDid = req.did ?? '';
    const dids = didsParam.split(',').filter(Boolean).slice(0, 100);

    void (async () => {
      const rawPresence = await service.getBulkPresence(dids);

      // Resolve all visibilities in one bulk call
      const visibilityMap = await service.getVisibleToBulk(dids);

      // Partition DIDs by visibility level for batch queries
      const communityCheckDids: string[] = [];
      const innerCircleCheckDids: string[] = [];

      for (const p of rawPresence) {
        if (blockService.isBlocked(requesterDid, p.did)) continue;
        const v = visibilityMap.get(p.did) ?? 'no-one';
        if (v === 'community' || v === 'inner-circle') {
          communityCheckDids.push(p.did);
        }
        if (v === 'inner-circle') {
          innerCircleCheckDids.push(p.did);
        }
      }

      // 2 batch queries instead of N×2
      const [communityMembers, innerCircleMembers] = await Promise.all([
        batchCheckMembership(sql, communityCheckDids, requesterDid),
        batchCheckInnerCircle(sql, innerCircleCheckDids, requesterDid),
      ]);

      const presence = rawPresence.map((p) => {
        if (blockService.isBlocked(requesterDid, p.did)) {
          return { did: p.did, status: 'offline' as const };
        }
        const visibility = visibilityMap.get(p.did) ?? 'no-one';
        if (visibility === 'everyone') return p;

        const member = communityMembers.has(p.did);
        const friend = innerCircleMembers.has(p.did);

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
      });

      res.json({ presence });
    })().catch(next);
  });

  return router;
}

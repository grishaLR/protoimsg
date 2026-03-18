import { Router, type Request, type Response } from 'express';
import type { GroupCallService } from './service.js';
import { createLogger } from '../logger.js';

const log = createLogger('group-calls-router');

/**
 * REST endpoints for group calls.
 *
 * POST /api/calls/:callId/token — refresh LiveKit token for an active call
 * GET  /api/calls/room/:roomId  — check if a room has an active call
 */
export function groupCallRouter(callService: GroupCallService): Router {
  const router = Router();

  // Refresh token for an active call
  router.post('/:callId/token', async (req: Request<{ callId: string }>, res: Response) => {
    const did = (req as Request & { did?: string }).did;
    if (!did) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      const { token } = await callService.joinCall(req.params.callId, did);
      res.json({ token, url: callService.livekitUrl });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to refresh token';
      log.warn({ err, callId: req.params.callId, did }, 'Token refresh failed');
      res.status(404).json({ error: msg });
      return;
    }
  });

  // Check if a room has an active call
  router.get('/room/:roomId', (req: Request<{ roomId: string }>, res: Response) => {
    const call = callService.getCallForRoom(req.params.roomId);
    if (call) {
      res.json({
        callId: call.callId,
        participantCount: call.participants.size,
        createdAt: call.createdAt,
      });
    } else {
      res.json({ callId: null });
    }
  });

  return router;
}

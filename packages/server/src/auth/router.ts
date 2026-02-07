import { Router } from 'express';

export function authRouter(): Router {
  const router = Router();

  // GET /api/auth/login?handle=... — start OAuth flow
  router.get('/login', (_req, res) => {
    // TODO: Implement with ATProto OAuth
    res.status(501).json({ error: 'OAuth not yet configured' });
  });

  // GET /api/auth/callback — OAuth callback
  router.get('/callback', (_req, res) => {
    // TODO: Exchange code for session
    res.status(501).json({ error: 'OAuth not yet configured' });
  });

  // GET /api/auth/session — check current session
  router.get('/session', (_req, res) => {
    // TODO: Return current user from session
    res.status(501).json({ error: 'OAuth not yet configured' });
  });

  return router;
}

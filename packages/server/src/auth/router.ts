import { Router } from 'express';
import { z } from 'zod';
import type { SessionStore } from './session-store.js';
import type { ChallengeStore } from './challenge.js';
import { verifyDidHandle, verifyAuthRecord } from './verify.js';
import { createRequireAuth } from './middleware.js';
import type { Config } from '../config.js';
import type { GlobalBanService } from '../moderation/global-ban-service.js';
import { createLogger } from '../logger.js';

const log = createLogger('auth');

const challengeBodySchema = z.object({
  did: z.string(),
});

const sessionBodySchema = z.object({
  did: z.string(),
  handle: z.string(),
  nonce: z.string(),
  rkey: z.string(),
});

export function authRouter(
  sessions: SessionStore,
  config: Config,
  challenges: ChallengeStore,
  globalBans: GlobalBanService,
): Router {
  const router = Router();
  const requireAuth = createRequireAuth(sessions);

  // GET /api/auth/preflight?handle=<handle> — pre-OAuth ban check
  router.get('/preflight', async (req, res, next) => {
    try {
      const handle = req.query.handle;
      if (typeof handle !== 'string' || !handle) {
        res.status(400).json({ error: 'Missing handle query parameter' });
        return;
      }

      // Resolve handle → DID via public ATProto API
      const url = `${config.PUBLIC_API_URL}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`;
      const resolveRes = await fetch(url);
      if (!resolveRes.ok) {
        // Can't resolve handle — let OAuth handle the error naturally
        res.json({ allowed: true });
        return;
      }

      const data = (await resolveRes.json()) as { did: string };
      if (globalBans.isBanned(data.did)) {
        log.warn({ did: data.did, handle }, 'auth/preflight rejected: globally banned');
        res.status(403).json({ error: 'This account is not permitted to use this service.' });
        return;
      }

      res.json({ allowed: true });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/auth/challenge — issue a nonce for auth verification
  router.post('/challenge', (req, res, next) => {
    try {
      const parsed = challengeBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request body', details: parsed.error.issues });
        return;
      }

      if (globalBans.isBanned(parsed.data.did)) {
        log.warn({ did: parsed.data.did }, 'auth/challenge rejected: globally banned');
        res.status(403).json({ error: 'This account is not permitted to use this service.' });
        return;
      }

      const nonce = challenges.create(parsed.data.did);
      res.json({ nonce });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/auth/session — create session via challenge-response proof
  router.post('/session', async (req, res, next) => {
    try {
      const parsed = sessionBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request body', details: parsed.error.issues });
        return;
      }

      const { did, handle, nonce, rkey } = parsed.data;

      if (globalBans.isBanned(did)) {
        log.warn({ did, handle }, 'auth/session rejected: globally banned');
        res.status(403).json({ error: 'This account is not permitted to use this service.' });
        return;
      }

      // Step 1: Consume nonce — rejects if not found, expired, or already used
      if (!challenges.consume(did, nonce)) {
        log.warn({ did, handle }, 'auth/session failed: invalid challenge');
        res.status(401).json({ error: 'Invalid or expired challenge' });
        return;
      }

      // Step 2: Verify handle → DID resolution (public identity check)
      const verified = await verifyDidHandle(did, handle, config.PUBLIC_API_URL);
      if (!verified) {
        log.warn({ did, handle }, 'auth/session failed: handle mismatch');
        res.status(401).json({ error: 'Handle does not resolve to provided DID' });
        return;
      }

      // Step 3: Verify the auth record on the user's PDS proves write access
      const recordValid = await verifyAuthRecord(did, nonce, rkey);
      if (!recordValid) {
        log.warn({ did, handle }, 'auth/session failed: record verification');
        res
          .status(401)
          .json({ error: 'Auth verification failed — record not found or nonce mismatch' });
        return;
      }

      const token = await sessions.create(did, handle, config.SESSION_TTL_MS);
      log.info({ did, handle }, 'auth/session created');
      res.status(201).json({ token, did, handle });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/auth/session — check current session
  router.get('/session', requireAuth, (req, res) => {
    res.json({ did: req.did, handle: req.handle });
  });

  // DELETE /api/auth/session — logout
  router.delete('/session', requireAuth, (req, res, next) => {
    const token = req.headers.authorization?.slice(7);
    if (token) {
      sessions
        .delete(token)
        .then(() => {
          log.info({ did: req.did ?? 'unknown' }, 'auth/session deleted');
          res.status(204).end();
        })
        .catch(next);
    } else {
      res.status(204).end();
    }
  });

  return router;
}

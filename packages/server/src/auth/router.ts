import { Router } from 'express';
import { z } from 'zod';
import type { SessionStore } from './session-store.js';
import type { ChallengeStore } from './challenge.js';
import { verifyDidHandle, verifyAuthRecord } from './verify.js';
import { createRequireAuth } from './middleware.js';
import type { Config } from '../config.js';

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
): Router {
  const router = Router();
  const requireAuth = createRequireAuth(sessions);

  // POST /api/auth/challenge — issue a nonce for auth verification
  router.post('/challenge', (req, res, next) => {
    try {
      const parsed = challengeBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request body', details: parsed.error.issues });
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

      // Step 1: Consume nonce — rejects if not found, expired, or already used
      if (!challenges.consume(did, nonce)) {
        console.warn(
          `[audit] auth/session failed: invalid challenge — did=${did} handle=${handle}`,
        );
        res.status(401).json({ error: 'Invalid or expired challenge' });
        return;
      }

      // Step 2: Verify handle → DID resolution (public identity check)
      const verified = await verifyDidHandle(did, handle, config.PUBLIC_API_URL);
      if (!verified) {
        console.warn(`[audit] auth/session failed: handle mismatch — did=${did} handle=${handle}`);
        res.status(401).json({ error: 'Handle does not resolve to provided DID' });
        return;
      }

      // Step 3: Verify the auth record on the user's PDS proves write access
      const recordValid = await verifyAuthRecord(did, nonce, rkey);
      if (!recordValid) {
        console.warn(
          `[audit] auth/session failed: record verification — did=${did} handle=${handle}`,
        );
        res
          .status(401)
          .json({ error: 'Auth verification failed — record not found or nonce mismatch' });
        return;
      }

      const token = await sessions.create(did, handle, config.SESSION_TTL_MS);
      console.info(`[audit] auth/session created — did=${did} handle=${handle}`);
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
          console.info(`[audit] auth/session deleted — did=${req.did ?? 'unknown'}`);
          res.status(204).end();
        })
        .catch(next);
    } else {
      res.status(204).end();
    }
  });

  return router;
}

import { Router } from 'express';
import { z } from 'zod';
import type { SessionStore } from './session-store.js';
import type { ChallengeStoreInterface } from './challenge.js';
import { verifyDidHandle, verifyAuthRecord } from './verify.js';
import { createRequireAuth } from './middleware.js';
import type { Config } from '../config.js';
import type { GlobalBanService } from '../moderation/global-ban-service.js';
import type { GlobalAllowlistService } from '../moderation/global-allowlist-service.js';
import { ERROR_CODES, USER_AGENT } from '@protoimsg/shared';
import type { NotificationService } from '../notifications/service.js';

import { createLogger } from '../logger.js';
import { incUniqueLogins } from '../stats/queries.js';
import { InMemoryRateLimiter } from '../moderation/rate-limiter.js';
import { createRateLimitMiddleware } from '../middleware/rate-limit.js';

const log = createLogger('auth');

/** Known PDS error types safe to forward to the client. */
const SAFE_PDS_ERRORS = new Set([
  'HandleNotAvailable',
  'InvalidHandle',
  'InvalidEmail',
  'InvalidPassword',
  'InvalidInviteCode',
  'UnsupportedDomain',
  'AccountTakedown',
  'UnresolvableDid',
]);

function sanitizePdsError(pdsError: { error?: string; message?: string }, status: number): string {
  // For 5xx (mapped to 502), always return generic message
  if (status >= 500) return 'Account creation failed. Please try again later.';
  // For known PDS error types, forward the human-readable message
  if (pdsError.error && SAFE_PDS_ERRORS.has(pdsError.error)) {
    return pdsError.message ?? pdsError.error;
  }
  return 'Account creation failed';
}

const signupBodySchema = z.object({
  handle: z
    .string()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]\.protoimsg\.app$/i, 'Invalid handle format'),
  email: z.string().email().max(254),
  password: z.string().min(8).max(256),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  turnstileToken: z.string().max(4096).optional(),
});

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
  challenges: ChallengeStoreInterface,
  globalBans: GlobalBanService,
  globalAllowlist: GlobalAllowlistService,
  sql?: import('../db/client.js').Sql,
  notificationService?: NotificationService | null,
): Router {
  const router = Router();
  const requireAuth = createRequireAuth(sessions);
  // Stricter rate limit for signup: 3 per minute per IP (account creation is expensive)
  const signupLimiter = new InMemoryRateLimiter({ windowMs: 60_000, maxRequests: 3 });

  // POST /api/auth/signup — Turnstile-verified proxy to PDS createAccount
  router.post('/signup', createRateLimitMiddleware(signupLimiter), async (req, res, next) => {
    try {
      const parsed = signupBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid request body',
          errorCode: ERROR_CODES.INVALID_INPUT,
          details: parsed.error.issues,
        });
        return;
      }

      const { handle, email, password, dob, turnstileToken } = parsed.data;

      // Verify Turnstile token if configured
      if (config.TURNSTILE_SECRET_KEY) {
        if (!turnstileToken) {
          res.status(403).json({
            error: 'CAPTCHA verification required',
            errorCode: ERROR_CODES.CAPTCHA_FAILED,
          });
          return;
        }

        const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal: AbortSignal.timeout(5000),
          body: new URLSearchParams({
            secret: config.TURNSTILE_SECRET_KEY,
            response: turnstileToken,
            remoteip: req.ip ?? '',
          }),
        });

        const verifyData = (await verifyRes.json()) as { success: boolean };
        if (!verifyData.success) {
          log.warn({ handle }, 'auth/signup rejected: Turnstile verification failed');
          res.status(403).json({
            error: 'CAPTCHA verification failed',
            errorCode: ERROR_CODES.CAPTCHA_FAILED,
          });
          return;
        }
      }

      // Proxy account creation to PDS
      const pdsUrl = config.PDS_URL ?? 'https://pds.protoimsg.app';
      const pdsRes = await fetch(`${pdsUrl}/xrpc/com.atproto.server.createAccount`, {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify({
          handle,
          email,
          password,
          birthDate: dob,
        }),
      });

      if (!pdsRes.ok) {
        const pdsError = (await pdsRes.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        log.warn(
          { handle, status: pdsRes.status, pdsError: pdsError.error },
          'auth/signup PDS error',
        );
        // Forward 4xx as client errors; map 5xx to 502 (upstream failure)
        const clientStatus = pdsRes.status >= 400 && pdsRes.status < 500 ? pdsRes.status : 502;
        res.status(clientStatus).json({
          error: sanitizePdsError(pdsError, clientStatus),
        });
        return;
      }

      const pdsData = (await pdsRes.json()) as { did: string; handle: string };
      log.info({ did: pdsData.did, handle: pdsData.handle }, 'auth/signup account created');

      // Auto-add to allowlist so the user can immediately log in
      if (sql) {
        await globalAllowlist.add(sql, pdsData.did, pdsData.handle, 'signup', 'system');
      }

      res.status(201).json({ did: pdsData.did, handle: pdsData.handle });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/auth/preflight — pre-OAuth ban + captcha check
  router.post('/preflight', async (req, res, next) => {
    try {
      const { handle, turnstileToken } = req.body as { handle?: string; turnstileToken?: string };
      if (typeof handle !== 'string' || !handle) {
        res.status(400).json({ error: 'Missing handle', errorCode: ERROR_CODES.INVALID_INPUT });
        return;
      }

      // Verify Turnstile token if configured
      if (config.TURNSTILE_SECRET_KEY) {
        if (!turnstileToken) {
          res.status(403).json({
            error: 'CAPTCHA verification required',
            errorCode: ERROR_CODES.CAPTCHA_FAILED,
          });
          return;
        }

        const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal: AbortSignal.timeout(5000),
          body: new URLSearchParams({
            secret: config.TURNSTILE_SECRET_KEY,
            response: turnstileToken,
            remoteip: req.ip ?? '',
          }),
        });

        const verifyData = (await verifyRes.json()) as { success: boolean };
        if (!verifyData.success) {
          log.warn({ handle }, 'auth/preflight rejected: Turnstile verification failed');
          res.status(403).json({
            error: 'CAPTCHA verification failed',
            errorCode: ERROR_CODES.CAPTCHA_FAILED,
          });
          return;
        }
      }

      // Resolve handle → DID via public ATProto API
      const url = `${config.PUBLIC_API_URL}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`;
      const resolveRes = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!resolveRes.ok) {
        // Can't resolve handle — let OAuth handle the error naturally
        res.json({ allowed: true });
        return;
      }

      const data = (await resolveRes.json()) as { did: string };
      if (globalBans.isBanned(data.did)) {
        log.warn({ did: data.did, handle }, 'auth/preflight rejected: globally banned');

        res.status(403).json({
          error: 'This account is not permitted to use this service.',
          errorCode: ERROR_CODES.BANNED,
        });

        return;
      }

      res.json({ allowed: true });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/auth/challenge — issue a nonce for auth verification
  router.post('/challenge', async (req, res, next) => {
    try {
      const parsed = challengeBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid request body',
          errorCode: ERROR_CODES.INVALID_INPUT,
          details: parsed.error.issues,
        });
        return;
      }

      if (globalBans.isBanned(parsed.data.did)) {
        log.warn({ did: parsed.data.did }, 'auth/challenge rejected: globally banned');
        res.status(403).json({
          error: 'This account is not permitted to use this service.',
          errorCode: ERROR_CODES.BANNED,
        });
        return;
      }

      const nonce = await challenges.create(parsed.data.did);
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
        res.status(400).json({
          error: 'Invalid request body',
          errorCode: ERROR_CODES.INVALID_INPUT,
          details: parsed.error.issues,
        });
        return;
      }

      const { did, handle, nonce, rkey } = parsed.data;

      if (globalBans.isBanned(did)) {
        log.warn({ did, handle }, 'auth/session rejected: globally banned');

        res.status(403).json({
          error: 'This account is not permitted to use this service.',
          errorCode: ERROR_CODES.BANNED,
        });

        return;
      }

      // Step 1: Consume nonce — rejects if not found, expired, or already used
      if (!(await challenges.consume(did, nonce))) {
        log.warn({ did, handle }, 'auth/session failed: invalid challenge');
        res.status(401).json({
          error: 'Invalid or expired challenge',
          errorCode: ERROR_CODES.INVALID_CHALLENGE,
        });
        return;
      }

      // Step 2: Verify handle → DID resolution (public identity check)
      const verified = await verifyDidHandle(did, handle, config.PUBLIC_API_URL);
      if (!verified) {
        log.warn({ did, handle }, 'auth/session failed: handle mismatch');
        res.status(401).json({
          error: 'Handle does not resolve to provided DID',
          errorCode: ERROR_CODES.HANDLE_MISMATCH,
        });
        return;
      }

      // Step 3: Verify the auth record on the user's PDS proves write access
      const recordValid = await verifyAuthRecord(did, nonce, rkey);
      if (!recordValid) {
        log.warn({ did, handle }, 'auth/session failed: record verification');
        res.status(401).json({
          error: 'Auth verification failed — record not found or nonce mismatch',
          errorCode: ERROR_CODES.AUTH_VERIFICATION_FAILED,
        });
        return;
      }

      const token = await sessions.create(did, handle, config.SESSION_TTL_MS);
      if (sql) void incUniqueLogins(sql);
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
        .then(async () => {
          log.info({ did: req.did ?? 'unknown' }, 'auth/session deleted');
          if (notificationService && req.did) {
            await notificationService.unregisterAllForDid(req.did);
          }
          res.status(204).end();
        })
        .catch(next);
    } else {
      res.status(204).end();
    }
  });

  return router;
}

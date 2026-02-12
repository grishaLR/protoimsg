import express, { type Express } from 'express';
import helmet from 'helmet';
import { corsMiddleware } from './middleware/cors.js';
import { createErrorHandler } from './middleware/error.js';
import { createRequestLogger } from './middleware/logger.js';
import { createRateLimitMiddleware } from './middleware/rate-limit.js';
import { roomsRouter } from './rooms/router.js';
import { messagesRouter } from './messages/router.js';
import { authRouter } from './auth/router.js';
import { createRequireAuth } from './auth/middleware.js';
import { ChallengeStore } from './auth/challenge.js';
import { presenceRouter } from './presence/router.js';
import { communityRouter } from './community/router.js';
import { moderationRouter } from './moderation/router.js';
import { dmRouter } from './dms/router.js';
import type { Config } from './config.js';
import type { Sql } from './db/client.js';
import type { PresenceService } from './presence/service.js';
import type { SessionStore } from './auth/session-store.js';
import type { RateLimiterStore } from './moderation/rate-limiter-store.js';
import type { BlockService } from './moderation/block-service.js';

export function createApp(
  config: Config,
  sql: Sql,
  presenceService: PresenceService,
  sessions: SessionStore,
  rateLimiter: RateLimiterStore,
  authRateLimiter: RateLimiterStore,
  blockService: BlockService,
): Express {
  const app = express();
  const requireAuth = createRequireAuth(sessions);

  // Middleware
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.use(corsMiddleware(config));
  app.use(createRequestLogger());

  // Health check (unprotected)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Auth routes (unprotected — login creates sessions; rate-limited by IP)
  const challenges = new ChallengeStore();
  app.use(
    '/api/auth',
    createRateLimitMiddleware(authRateLimiter),
    authRouter(sessions, config, challenges),
  );

  // Protected API routes
  app.use('/api/rooms', requireAuth, createRateLimitMiddleware(rateLimiter), roomsRouter(sql));
  app.use('/api/rooms', requireAuth, createRateLimitMiddleware(rateLimiter), messagesRouter(sql));
  app.use('/api/rooms', requireAuth, createRateLimitMiddleware(rateLimiter), moderationRouter(sql));
  app.use('/api/presence', requireAuth, presenceRouter(presenceService, blockService, sql));
  app.use('/api/community', requireAuth, communityRouter(sql));
  app.use('/api/dms', requireAuth, createRateLimitMiddleware(rateLimiter), dmRouter(sql));

  // Error handler (must be last)
  app.use(createErrorHandler(config));

  return app;
}

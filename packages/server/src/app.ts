import express, { type Express } from 'express';
import { corsMiddleware } from './middleware/cors.js';
import { createErrorHandler } from './middleware/error.js';
import { requestLogger } from './middleware/logger.js';
import { createRateLimitMiddleware } from './middleware/rate-limit.js';
import { roomsRouter } from './rooms/router.js';
import { messagesRouter } from './messages/router.js';
import { authRouter } from './auth/router.js';
import { createRequireAuth } from './auth/middleware.js';
import { presenceRouter } from './presence/router.js';
import { buddylistRouter } from './buddylist/router.js';
import { moderationRouter } from './moderation/router.js';
import { dmRouter } from './dms/router.js';
import type { Config } from './config.js';
import type { Sql } from './db/client.js';
import type { PresenceService } from './presence/service.js';
import type { SessionStore } from './auth/session.js';
import type { RateLimiter } from './moderation/rate-limiter.js';

export function createApp(
  config: Config,
  sql: Sql,
  presenceService: PresenceService,
  sessions: SessionStore,
  rateLimiter: RateLimiter,
): Express {
  const app = express();
  const requireAuth = createRequireAuth(sessions);

  // Middleware
  app.use(express.json());
  app.use(corsMiddleware(config));
  app.use(requestLogger);

  // Health check (unprotected)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Auth routes (unprotected — login creates sessions)
  app.use('/api/auth', authRouter(sessions, config));

  // Protected API routes
  app.use('/api/rooms', requireAuth, createRateLimitMiddleware(rateLimiter), roomsRouter(sql));
  app.use('/api/rooms', requireAuth, createRateLimitMiddleware(rateLimiter), messagesRouter(sql));
  app.use('/api/rooms', requireAuth, createRateLimitMiddleware(rateLimiter), moderationRouter(sql));
  app.use('/api/presence', requireAuth, presenceRouter(presenceService));
  app.use('/api/buddylist', requireAuth, buddylistRouter(sql));
  app.use('/api/dms', requireAuth, createRateLimitMiddleware(rateLimiter), dmRouter(sql));

  // Error handler (must be last)
  app.use(createErrorHandler(config));

  return app;
}

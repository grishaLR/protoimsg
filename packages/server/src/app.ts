import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import { corsMiddleware } from './middleware/cors.js';
import { createErrorHandler } from './middleware/error.js';
import { createRequestLogger } from './middleware/logger.js';
import { createRateLimitMiddleware } from './middleware/rate-limit.js';
import { authRouter } from './auth/router.js';
import { createRequireAuth } from './auth/middleware.js';
import type { ChallengeStoreInterface } from './auth/challenge.js';
import { presenceRouter } from './presence/router.js';
import { communityRouter } from './community/router.js';
import { gifRouter } from './giphy/router.js';
import { iceRouter } from './ice/router.js';
import { feedbackRouter } from './feedback/router.js';
import { adminRouter } from './admin/router.js';
import { notificationsRouter } from './notifications/router.js';
import type { NotificationService } from './notifications/service.js';
import type { Config } from './config.js';
import type { Sql } from './db/client.js';
import type { PresenceService } from './presence/service.js';
import type { SessionStore } from './auth/session-store.js';
import type { RateLimiterStore } from './moderation/rate-limiter-store.js';
import type { BlockService } from './moderation/block-service.js';
import type { GlobalBanService } from './moderation/global-ban-service.js';
import type { GlobalAllowlistService } from './moderation/global-allowlist-service.js';
import type { EmailService } from './email/service.js';
import type { Redis } from './redis/client.js';
import type { GroupCallService } from './calls/service.js';
import { groupCallRouter } from './calls/router.js';
import { getMetricsText, getMetricsContentType, observeHttpRequestDuration } from './metrics.js';
import { checkHealth } from './health.js';
import { audioProxyRouter } from './audio-proxy.js';

export function createApp(
  config: Config,
  sql: Sql,
  presenceService: PresenceService,
  sessions: SessionStore,
  rateLimiter: RateLimiterStore,
  authRateLimiter: RateLimiterStore,
  blockService: BlockService,
  globalBans: GlobalBanService,
  globalAllowlist: GlobalAllowlistService,
  challenges: ChallengeStoreInterface,
  giphyApiKey?: string | null,
  klipyApiKey?: string | null,
  gifRateLimiter?: RateLimiterStore | null,
  redis?: Redis | null,
  isJetstreamConnected?: () => boolean,
  jetstreamInstance?: () => string,
  firehoseFailover?: () => void,
  emailService?: EmailService | null,
  notificationService?: NotificationService | null,
  groupCallService?: GroupCallService | null,
): Express {
  const app = express();
  // Trust one proxy hop (Fly.io) so req.ip reflects the real client IP
  app.set('trust proxy', 1);
  const requireAuth = createRequireAuth(sessions);

  // Middleware
  app.use(helmet());
  app.use((req, res, next) => {
    // Skip global body parser for report route — it has its own 6mb limit
    if (req.path.startsWith('/api/feedback/report')) {
      next();
      return;
    }
    express.json({ limit: '100kb' })(req, res, next);
  });
  app.use(corsMiddleware(config));
  app.use(createRequestLogger());

  // Prometheus metrics (internal-only on Fly.io)
  // Fly.io strips fly-client-ip from internal requests, so its presence means external.
  // Additionally require ADMIN_API_KEY when set for defense-in-depth.
  app.get('/metrics', async (req, res) => {
    if (req.headers['fly-client-ip']) {
      res.status(404).end();
      return;
    }
    if (config.ADMIN_API_KEY && req.headers['authorization'] !== `Bearer ${config.ADMIN_API_KEY}`) {
      res.status(404).end();
      return;
    }
    res.set('Content-Type', getMetricsContentType());
    res.end(await getMetricsText());
  });

  // Deep health check
  app.get('/health', async (_req, res) => {
    const { response, httpStatus } = await checkHealth(
      sql,
      redis ?? null,
      isJetstreamConnected ?? (() => true),
      jetstreamInstance,
    );
    res.status(httpStatus).json(response);
  });

  // HTTP request duration metrics
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = performance.now();
    res.on('finish', () => {
      const seconds = (performance.now() - start) / 1000;
      const route = (req.route as { path?: string } | undefined)?.path ?? req.path;
      observeHttpRequestDuration(req.method, route, res.statusCode, seconds);
    });
    next();
  });

  // Auth routes (unprotected — login creates sessions; rate-limited by IP)
  app.use(
    '/api/auth',
    createRateLimitMiddleware(authRateLimiter),
    authRouter(sessions, config, challenges, globalBans, globalAllowlist, sql, notificationService),
  );

  // Admin routes (API key protected — only mounted when ADMIN_API_KEY is set)
  if (config.ADMIN_API_KEY) {
    app.use(
      '/api/admin',
      adminRouter(
        sql,
        globalAllowlist,
        config.ADMIN_API_KEY,
        config.PUBLIC_API_URL,
        emailService ?? null,
        firehoseFailover,
      ),
    );
  }

  // Protected API routes
  app.use(
    '/api/presence',
    requireAuth,
    createRateLimitMiddleware(rateLimiter),
    presenceRouter(presenceService, blockService, sql),
  );
  app.use(
    '/api/community',
    requireAuth,
    createRateLimitMiddleware(rateLimiter),
    communityRouter(sql),
  );
  app.use('/api/feedback', requireAuth, feedbackRouter(sql, emailService ?? null));
  app.use(
    '/api/ice-servers',
    requireAuth,
    iceRouter({
      stunUrl: config.STUN_URL,
      turnUrl: config.TURN_URL,
      sharedSecret: config.COTURN_SHARED_SECRET,
      ttlSeconds: config.ICE_CREDENTIAL_TTL_SECS,
    }),
  );

  // Group call routes (optional — only mounted when LiveKit is configured)
  if (groupCallService) {
    app.use(
      '/api/calls',
      requireAuth,
      createRateLimitMiddleware(rateLimiter),
      groupCallRouter(groupCallService),
    );
  }

  // Device token registration for push notifications
  if (notificationService) {
    app.use(
      '/api/device-tokens',
      requireAuth,
      createRateLimitMiddleware(rateLimiter),
      notificationsRouter(notificationService),
    );
  }

  // Audio proxy — allows web client to use Web Audio API on cross-origin audio (CORS bypass)
  app.use('/api/audio-proxy', createRateLimitMiddleware(rateLimiter), audioProxyRouter());

  // GIF proxy (optional — mounted when either GIPHY_API_KEY or KLIPY_API_KEY is set)
  if ((giphyApiKey || klipyApiKey) && gifRateLimiter) {
    // Capabilities is public (client checks before login)
    app.get('/api/gif/capabilities', (_req, res) => {
      res.json({ giphy: !!giphyApiKey, klipy: !!klipyApiKey });
    });
    app.use(
      '/api/gif',
      requireAuth,
      gifRouter(giphyApiKey ?? null, klipyApiKey ?? null, gifRateLimiter),
    );
  }

  // Error handler (must be last)
  app.use(createErrorHandler(config));

  return app;
}

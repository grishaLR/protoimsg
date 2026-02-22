import { createServer } from 'http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { initSentry, Sentry } from './sentry.js';
import { initLogger, createLogger } from './logger.js';
import { createDb } from './db/client.js';
import { createFirehoseConsumer } from './firehose/consumer.js';
import { createWsServer } from './ws/server.js';
import { InMemoryPresenceTracker } from './presence/tracker.js';
import { RedisPresenceTracker } from './presence/tracker-redis.js';
import { createPresenceService } from './presence/service.js';
import { InMemorySessionStore } from './auth/session.js';
import { RedisSessionStore } from './auth/session-redis.js';
import { createRedisClient } from './redis/client.js';
import { InMemoryRateLimiter } from './moderation/rate-limiter.js';
import { RedisRateLimiter } from './moderation/rate-limiter-redis.js';
import { BlockService } from './moderation/block-service.js';
import { GlobalBanService } from './moderation/global-ban-service.js';
import { GlobalAllowlistService } from './moderation/global-allowlist-service.js';
import { LabelerService } from './moderation/labeler-service.js';
import { createDmService } from './dms/service.js';
import { createImRegistry } from './dms/registry.js';
import { createTranslateService, getSupportedLanguages } from './translate/service.js';
import { ChallengeStore } from './auth/challenge.js';
import { RedisChallengeStore } from './auth/challenge-redis.js';
import { LIMITS } from '@protoimsg/shared';
import { pruneOldMessages } from './messages/queries.js';
import { pruneTypingThrottle, pruneCallAttempts } from './ws/handlers.js';
import { pruneSlowModeTracker } from './firehose/handlers.js';
import { EmailService } from './email/service.js';

async function main() {
  const config = loadConfig();
  initSentry(config);
  initLogger(config);
  const log = createLogger('server');

  process.on('unhandledRejection', (reason) => {
    log.fatal({ err: reason }, 'Unhandled rejection');
    Sentry.captureException(reason);
    void Sentry.flush(2000).finally(() => process.exit(1));
  });

  process.on('uncaughtException', (err) => {
    log.fatal({ err }, 'Uncaught exception');
    Sentry.captureException(err);
    void Sentry.flush(2000).finally(() => process.exit(1));
  });

  const db = createDb(config.DATABASE_URL, {
    max: config.DB_POOL_MAX,
    idleTimeout: config.DB_IDLE_TIMEOUT,
    connectTimeout: config.DB_CONNECT_TIMEOUT,
  });

  // Redis client (optional — falls back to in-memory stores when absent)
  const redis = config.REDIS_URL ? createRedisClient(config.REDIS_URL) : null;
  if (redis) await redis.connect();

  // Shared presence tracker + service (used by both HTTP routes and WS)
  const tracker = redis ? new RedisPresenceTracker(redis) : new InMemoryPresenceTracker();
  const presenceService = createPresenceService(tracker);

  // Auth sessions + rate limiters (stricter for auth by IP)
  const sessions = redis
    ? new RedisSessionStore(redis, config.SESSION_TTL_MS)
    : new InMemorySessionStore(config.SESSION_TTL_MS);
  const rateLimiter = redis ? new RedisRateLimiter(redis) : new InMemoryRateLimiter();
  const authRateLimiter = redis
    ? new RedisRateLimiter(redis, { windowMs: 60_000, maxRequests: 10 })
    : new InMemoryRateLimiter({ windowMs: 60_000, maxRequests: 10 });

  // DM service (video calls still use DB), IM registry (P2P signaling), block service
  const dmService = createDmService(db);
  const imRegistry = createImRegistry();
  const blockService = new BlockService();

  // Global account bans — load into memory for O(1) checks
  const globalBans = new GlobalBanService();
  await globalBans.load(db);

  // Global allowlist — when enabled, only listed DIDs can authenticate
  const globalAllowlist = new GlobalAllowlistService(config.REQUIRE_ALLOWLIST);
  await globalAllowlist.load(db);

  // Labeler service — checks profile labels via public API for server-side enforcement
  const labelerService = new LabelerService();

  // Auth challenge store (Redis when available, else in-memory)
  const challenges = redis ? new RedisChallengeStore(redis) : new ChallengeStore();

  // Translation service (optional — requires at least one backend)
  const translateService = config.TRANSLATE_ENABLED
    ? createTranslateService({
        sql: db,
        libreTranslateUrl: config.LIBRETRANSLATE_URL,
        nllbUrl: config.NLLB_URL,
        nllbApiKey: config.NLLB_API_KEY,
      })
    : null;
  const supportedLanguages = config.TRANSLATE_ENABLED
    ? getSupportedLanguages(config.LIBRETRANSLATE_URL, config.NLLB_URL)
    : [];
  const translateRateLimiter = config.TRANSLATE_ENABLED
    ? redis
      ? new RedisRateLimiter(redis, { windowMs: 60_000, maxRequests: config.TRANSLATE_RATE_LIMIT })
      : new InMemoryRateLimiter({ windowMs: 60_000, maxRequests: config.TRANSLATE_RATE_LIMIT })
    : null;

  if (translateService) {
    log.info(
      {
        libreUrl: config.LIBRETRANSLATE_URL,
        nllbUrl: config.NLLB_URL,
        languages: supportedLanguages.length,
      },
      'Translation service enabled',
    );
  }

  // GIF proxy (optional — requires at least one of GIPHY_API_KEY or KLIPY_API_KEY)
  const hasGifService = !!(config.GIPHY_API_KEY || config.KLIPY_API_KEY);
  const gifRateLimiter = hasGifService
    ? redis
      ? new RedisRateLimiter(redis, { windowMs: 60_000, maxRequests: 30 })
      : new InMemoryRateLimiter({ windowMs: 60_000, maxRequests: 30 })
    : null;

  if (hasGifService) {
    const sources = [config.GIPHY_API_KEY ? 'Giphy' : null, config.KLIPY_API_KEY ? 'Klipy' : null]
      .filter(Boolean)
      .join(' + ');
    log.info(`GIF proxy enabled (${sources})`);
  }

  // Email service (optional — requires RESEND_API_KEY)
  const emailService = config.RESEND_API_KEY
    ? new EmailService(config.RESEND_API_KEY, config.RESEND_FROM)
    : null;
  if (emailService) {
    log.info('Email service enabled (Resend)');
  } else {
    log.warn('RESEND_API_KEY not set — waitlist confirmation emails will be skipped');
  }

  const app = createApp(
    config,
    db,
    presenceService,
    sessions,
    rateLimiter,
    authRateLimiter,
    blockService,
    globalBans,
    globalAllowlist,
    challenges,
    translateService,
    translateRateLimiter,
    supportedLanguages,
    config.GIPHY_API_KEY,
    config.KLIPY_API_KEY,
    gifRateLimiter,
    redis,
    () => firehose.isConnected(),
    () => {
      firehose.failover();
    },
    emailService,
  );
  const httpServer = createServer(app);

  // WebSocket server (shares the HTTP server and block service)
  const wss = createWsServer(
    httpServer,
    db,
    presenceService,
    sessions,
    rateLimiter,
    dmService,
    imRegistry,
    blockService,
    globalBans,
    globalAllowlist,
    labelerService,
  );
  log.info('WebSocket server attached');

  // Firehose consumer
  // Jetstream consumer (atproto event stream)
  const firehose = createFirehoseConsumer(
    config.JETSTREAM_URL,
    db,
    wss,
    presenceService,
    sessions,
    labelerService,
  );
  firehose.start();

  // Periodic cleanup (every 60s for sessions/rate limiter, message retention checked each cycle)
  const pruneInterval = setInterval(() => {
    void sessions.prune();
    void rateLimiter.prune();
    void dmService.pruneExpired();
    pruneTypingThrottle();
    pruneCallAttempts();
    pruneSlowModeTracker();
    void pruneOldMessages(db, LIMITS.defaultRetentionDays).then((count) => {
      if (count > 0) log.info({ count }, 'Pruned old room messages');
    });
  }, 60_000);

  httpServer.listen(config.PORT, config.HOST, () => {
    log.info({ host: config.HOST, port: config.PORT }, 'Server listening');
    log.info({ env: config.NODE_ENV }, 'Environment');
  });

  // Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down...');
    clearInterval(pruneInterval);
    await firehose.stop();

    // Close WS server and wait for all close handlers to drain.
    // WS close handlers contain async work (DM cleanup, presence
    // notifications) that needs the DB — must finish before db.end().
    await wss.close();

    await new Promise<void>((resolve) => {
      httpServer.close(() => {
        resolve();
      });
    });

    await db.end();
    if (redis) await redis.quit();
    log.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

void main();

import { createServer } from 'http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { initSentry } from './sentry.js';
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
import { createDmService } from './dms/service.js';
import { LIMITS } from '@protoimsg/shared';
import { pruneOldMessages } from './messages/queries.js';

async function main() {
  const config = loadConfig();
  initSentry(config);
  initLogger(config);
  const log = createLogger('server');

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

  // DM service + block service (shared by HTTP presence route and WS)
  const dmService = createDmService(db);
  const blockService = new BlockService();

  const app = createApp(
    config,
    db,
    presenceService,
    sessions,
    rateLimiter,
    authRateLimiter,
    blockService,
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
    blockService,
  );
  log.info('WebSocket server attached');

  // Firehose consumer
  // Jetstream consumer (atproto event stream)
  const firehose = createFirehoseConsumer(config.JETSTREAM_URL, db, wss, presenceService, sessions);
  firehose.start();

  // Periodic cleanup (every 60s for sessions/rate limiter, message retention checked each cycle)
  const pruneInterval = setInterval(() => {
    void sessions.prune();
    void rateLimiter.prune();
    void dmService.pruneExpired();
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

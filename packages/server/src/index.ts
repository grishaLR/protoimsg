import { createServer } from 'http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { createFirehoseConsumer } from './firehose/consumer.js';
import { createWsServer } from './ws/server.js';
import { PresenceTracker } from './presence/tracker.js';
import { createPresenceService } from './presence/service.js';
import { SessionStore } from './auth/session.js';
import { RateLimiter } from './moderation/rate-limiter.js';
import { BlockService } from './moderation/block-service.js';
import { createDmService } from './dms/service.js';
import { LIMITS } from '@protoimsg/shared';
import { pruneOldMessages } from './messages/queries.js';

function main() {
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);

  // Shared presence tracker + service (used by both HTTP routes and WS)
  const tracker = new PresenceTracker();
  const presenceService = createPresenceService(tracker);

  // Auth sessions + rate limiters (stricter for auth by IP)
  const sessions = new SessionStore(config.SESSION_TTL_MS);
  const rateLimiter = new RateLimiter();
  const authRateLimiter = new RateLimiter({ windowMs: 60_000, maxRequests: 10 });

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
  console.info('WebSocket server attached');

  // Firehose consumer
  // Jetstream consumer (atproto event stream)
  const firehose = createFirehoseConsumer(config.JETSTREAM_URL, db, wss, presenceService, sessions);
  firehose.start();

  // Periodic cleanup (every 60s for sessions/rate limiter, message retention checked each cycle)
  const pruneInterval = setInterval(() => {
    sessions.prune();
    rateLimiter.prune();
    void dmService.pruneExpired();
    void pruneOldMessages(db, LIMITS.defaultRetentionDays).then((count) => {
      if (count > 0) console.info(`Pruned ${String(count)} old room messages`);
    });
  }, 60_000);

  httpServer.listen(config.PORT, config.HOST, () => {
    console.info(`Server listening on http://${config.HOST}:${config.PORT}`);
    console.info(`Environment: ${config.NODE_ENV}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.info('Shutting down...');
    clearInterval(pruneInterval);
    await firehose.stop();
    wss.close();
    httpServer.close(() => {
      void db.end().then(() => {
        console.info('Shutdown complete');
        process.exit(0);
      });
    });
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main();

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
import { createDmService } from './dms/service.js';
import { LIMITS } from '@chatmosphere/shared';
import { pruneOldMessages } from './messages/queries.js';

function main() {
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);

  // Shared presence tracker + service (used by both HTTP routes and WS)
  const tracker = new PresenceTracker();
  const presenceService = createPresenceService(tracker);

  // Auth sessions + rate limiter
  const sessions = new SessionStore(config.SESSION_TTL_MS);
  const rateLimiter = new RateLimiter();

  // DM service
  const dmService = createDmService(db);

  const app = createApp(config, db, presenceService, sessions, rateLimiter);
  const httpServer = createServer(app);

  // WebSocket server (shares the HTTP server)
  const wss = createWsServer(httpServer, db, presenceService, sessions, rateLimiter, dmService);
  console.log('WebSocket server attached');

  // Firehose consumer
  // Jetstream consumer (atproto event stream)
  const firehose = createFirehoseConsumer(config.JETSTREAM_URL, db, wss);
  firehose.start();

  // Periodic cleanup (every 60s for sessions/rate limiter, message retention checked each cycle)
  const pruneInterval = setInterval(() => {
    sessions.prune();
    rateLimiter.prune();
    void dmService.pruneExpired();
    void pruneOldMessages(db, LIMITS.defaultRetentionDays).then((count) => {
      if (count > 0) console.log(`Pruned ${String(count)} old room messages`);
    });
  }, 60_000);

  httpServer.listen(config.PORT, config.HOST, () => {
    console.log(`Server listening on http://${config.HOST}:${config.PORT}`);
    console.log(`Environment: ${config.NODE_ENV}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('Shutting down...');
    clearInterval(pruneInterval);
    firehose.stop();
    wss.close();
    httpServer.close(() => {
      void db.end().then(() => {
        console.log('Shutdown complete');
        process.exit(0);
      });
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();

import { createServer } from 'http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { createFirehoseConsumer } from './firehose/consumer.js';
import { createWsServer } from './ws/server.js';
import { PresenceTracker } from './presence/tracker.js';
import { createPresenceService } from './presence/service.js';

function main() {
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);

  // Shared presence tracker + service (used by both HTTP routes and WS)
  const tracker = new PresenceTracker();
  const presenceService = createPresenceService(tracker);

  const app = createApp(config, db, presenceService);
  const httpServer = createServer(app);

  // WebSocket server (shares the HTTP server)
  const wss = createWsServer(httpServer, db, presenceService);
  console.log('WebSocket server attached');

  // Firehose consumer
  // Jetstream consumer (ATProto event stream)
  const firehose = createFirehoseConsumer(config.JETSTREAM_URL, db, wss);
  firehose.start();

  httpServer.listen(config.PORT, config.HOST, () => {
    console.log(`Server listening on http://${config.HOST}:${config.PORT}`);
    console.log(`Environment: ${config.NODE_ENV}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('Shutting down...');
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

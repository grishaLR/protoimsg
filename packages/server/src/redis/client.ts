import { Redis, type Command } from 'ioredis';
import { createLogger } from '../logger.js';

const log = createLogger('redis');

const REPORT_INTERVAL_MS = 60 * 60 * 1000;
const RATE_CHECK_INTERVAL_MS = 60 * 1000;
const RATE_WARN_THRESHOLD_PER_MIN = 5000;

export function createRedisClient(url: string): Redis {
  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

  client.on('error', (err: Error) => {
    log.error({ err }, 'Redis connection error');
  });

  client.on('connect', () => {
    log.info('Redis connected');
  });

  let hourCounts: Record<string, number> = {};
  let hourTotal = 0;
  let minuteTotal = 0;
  const origSendCommand = client.sendCommand.bind(client);
  client.sendCommand = ((command: Command) => {
    const name = command.name.toLowerCase();
    hourCounts[name] = (hourCounts[name] ?? 0) + 1;
    hourTotal += 1;
    minuteTotal += 1;
    return origSendCommand(command);
  }) as typeof client.sendCommand;

  const reportInterval = setInterval(() => {
    if (hourTotal === 0) return;
    log.info({ total: hourTotal, counts: hourCounts }, 'redis op counts (last hour)');
    hourCounts = {};
    hourTotal = 0;
  }, REPORT_INTERVAL_MS);
  reportInterval.unref();

  const rateCheckInterval = setInterval(() => {
    const delta = minuteTotal;
    minuteTotal = 0;
    if (delta >= RATE_WARN_THRESHOLD_PER_MIN) {
      log.warn(
        { commandsLastMin: delta, threshold: RATE_WARN_THRESHOLD_PER_MIN, topCounts: hourCounts },
        'redis op rate exceeded threshold — possible runaway',
      );
    }
  }, RATE_CHECK_INTERVAL_MS);
  rateCheckInterval.unref();

  return client;
}

export type { Redis };

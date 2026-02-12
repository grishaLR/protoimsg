import { Redis } from 'ioredis';
import { createLogger } from '../logger.js';

const log = createLogger('redis');

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

  return client;
}

export type { Redis };

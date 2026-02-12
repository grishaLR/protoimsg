import { Redis } from 'ioredis';

export function createRedisClient(url: string): Redis {
  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

  client.on('error', (err: Error) => {
    console.error('Redis connection error:', err.message);
  });

  client.on('connect', () => {
    console.info('Redis connected');
  });

  return client;
}

export type { Redis };

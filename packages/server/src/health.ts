import type { Sql } from './db/client.js';
import type { Redis } from './redis/client.js';

interface CheckResult {
  status: 'ok' | 'error';
  latencyMs: number;
}

interface HealthResponse {
  status: 'ok' | 'degraded';
  checks: {
    db: CheckResult;
    redis?: CheckResult;
    jetstream?: { status: 'ok' | 'error'; connected: boolean; instance?: string };
  };
}

const HEALTH_CHECK_TIMEOUT_MS = 3000;

export async function checkHealth(
  sql: Sql,
  redis: Redis | null,
  isJetstreamConnected: () => boolean,
  jetstreamInstance?: () => string,
): Promise<{ response: HealthResponse; httpStatus: number }> {
  const checks: HealthResponse['checks'] = {
    db: { status: 'error', latencyMs: 0 },
  };

  // DB check (with timeout so health endpoint never hangs)
  const dbStart = performance.now();
  try {
    await Promise.race([
      sql`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => {
          reject(new Error('DB health check timeout'));
        }, HEALTH_CHECK_TIMEOUT_MS),
      ),
    ]);
    checks.db = { status: 'ok', latencyMs: Math.round(performance.now() - dbStart) };
  } catch {
    checks.db = {
      status: 'error',
      latencyMs: Math.round(performance.now() - dbStart),
    };
  }

  // Redis check (if configured, with timeout)
  if (redis) {
    const redisStart = performance.now();
    try {
      await Promise.race([
        redis.ping(),
        new Promise((_, reject) =>
          setTimeout(() => {
            reject(new Error('Redis health check timeout'));
          }, HEALTH_CHECK_TIMEOUT_MS),
        ),
      ]);
      checks.redis = { status: 'ok', latencyMs: Math.round(performance.now() - redisStart) };
    } catch {
      checks.redis = {
        status: 'error',
        latencyMs: Math.round(performance.now() - redisStart),
      };
    }
  }

  // Jetstream check
  const connected = isJetstreamConnected();
  checks.jetstream = {
    status: connected ? 'ok' : 'error',
    connected,
    instance: jetstreamInstance?.(),
  };

  // DB down = 503 (server can't function). Everything else = 200 degraded.
  const dbOk = checks.db.status === 'ok';
  const allOk = dbOk && (!checks.redis || checks.redis.status === 'ok') && connected;

  return {
    response: { status: allOk ? 'ok' : 'degraded', checks },
    httpStatus: dbOk ? 200 : 503,
  };
}

import * as Sentry from '@sentry/node';
import type { Config } from './config.js';
import { createLogger } from './logger.js';

export function initSentry(
  config: Pick<Config, 'SENTRY_DSN' | 'SENTRY_ENVIRONMENT' | 'NODE_ENV'>,
): void {
  if (!config.SENTRY_DSN) return;
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.SENTRY_ENVIRONMENT ?? config.NODE_ENV,
  });
  const log = createLogger('sentry');
  log.info('Sentry initialized');
}

export { Sentry };

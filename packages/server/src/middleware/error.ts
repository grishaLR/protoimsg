import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '../logger.js';
import { Sentry } from '../sentry.js';
import type { Config } from '../config.js';

const log = createLogger('error-handler');

export function createErrorHandler(
  config: Config,
): (err: unknown, req: Request, res: Response, next: NextFunction) => void {
  return (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    Sentry.captureException(err);
    log.error({ err }, 'Unhandled error');

    const message =
      config.NODE_ENV !== 'production' && err instanceof Error
        ? err.message
        : 'Internal server error';

    res.status(500).json({ error: message });
  };
}

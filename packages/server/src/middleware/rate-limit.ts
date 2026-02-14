import type { Request, Response, NextFunction } from 'express';
import { ERROR_CODES } from '@protoimsg/shared';
import type { RateLimiterStore } from '../moderation/rate-limiter-store.js';

export function createRateLimitMiddleware(
  limiter: RateLimiterStore,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.did ?? req.ip ?? 'unknown';
    limiter
      .check(key)
      .then((allowed) => {
        if (!allowed) {
          res.status(429).json({ error: 'Too many requests', errorCode: ERROR_CODES.RATE_LIMITED });
          return;
        }
        next();
      })
      .catch(next);
  };
}

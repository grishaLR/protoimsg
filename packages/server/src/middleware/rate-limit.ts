import type { Request, Response, NextFunction } from 'express';
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
          res.status(429).json({ error: 'Too many requests' });
          return;
        }
        next();
      })
      .catch(next);
  };
}

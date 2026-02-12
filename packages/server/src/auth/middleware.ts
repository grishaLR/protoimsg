import type { Request, Response, NextFunction } from 'express';
import type { SessionStore } from './session-store.js';
import { createLogger } from '../logger.js';

const log = createLogger('auth');

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      did?: string;
      handle?: string;
    }
  }
}

export function createRequireAuth(
  sessions: SessionStore,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      log.warn({ method: req.method, path: req.path }, 'Auth rejected: missing header');
      res.status(401).json({ error: 'Missing authorization header' });
      return;
    }

    const token = authHeader.slice(7);
    sessions
      .get(token)
      .then((session) => {
        if (!session) {
          log.warn({ method: req.method, path: req.path }, 'Auth rejected: invalid/expired token');
          res.status(401).json({ error: 'Invalid or expired session' });
          return;
        }

        req.did = session.did;
        req.handle = session.handle;
        next();
      })
      .catch(next);
  };
}

import type { Request, Response, NextFunction } from 'express';
import type { SessionStore } from './session-store.js';

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
      console.warn(`[audit] auth rejected: missing header — ${req.method} ${req.path}`);
      res.status(401).json({ error: 'Missing authorization header' });
      return;
    }

    const token = authHeader.slice(7);
    sessions
      .get(token)
      .then((session) => {
        if (!session) {
          console.warn(`[audit] auth rejected: invalid/expired token — ${req.method} ${req.path}`);
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

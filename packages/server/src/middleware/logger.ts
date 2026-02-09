import type { Request, Response, NextFunction } from 'express';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.info(`${req.method} ${req.path} ${String(res.statusCode)} ${String(duration)}ms`);
  });
  next();
}

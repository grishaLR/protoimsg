import cors from 'cors';
import type { Config } from '../config.js';

export function corsMiddleware(config: Config) {
  return cors({
    origin: config.CORS_ORIGIN,
    credentials: true,
  });
}

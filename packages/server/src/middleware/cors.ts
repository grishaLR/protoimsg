import cors from 'cors';
import type { Config } from '../config.js';

export function corsMiddleware(config: Config) {
  const origins = config.CORS_ORIGIN.split(',').map((s) => s.trim());
  return cors({
    origin: origins.length === 1 ? origins[0] : origins,
    credentials: true,
  });
}

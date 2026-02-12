import cors from 'cors';
import type { Config } from '../config.js';

export function corsMiddleware(config: Config) {
  const origins = config.CORS_ORIGIN.split(',').map((s) => s.trim());
  if (config.NODE_ENV === 'production') {
    const invalid = origins.filter((o) => !o.startsWith('https://'));
    if (invalid.length > 0) {
      throw new Error(`CORS_ORIGIN must use HTTPS in production. Invalid: ${invalid.join(', ')}`);
    }
  }
  return cors({
    origin: origins.length === 1 ? origins[0] : origins,
    credentials: true,
  });
}

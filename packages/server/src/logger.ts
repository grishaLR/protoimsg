import pino from 'pino';
import type { Config } from './config.js';

let rootLogger: pino.Logger | undefined;

export function initLogger(config: Pick<Config, 'LOG_LEVEL' | 'NODE_ENV'>): pino.Logger {
  rootLogger = pino({
    level: config.LOG_LEVEL ?? (config.NODE_ENV === 'production' ? 'info' : 'debug'),
    ...(config.NODE_ENV !== 'production' && {
      transport: { target: 'pino-pretty', options: { colorize: true } },
    }),
    serializers: pino.stdSerializers,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', '*.token', '*.password'],
    },
  });
  return rootLogger;
}

export function getLogger(): pino.Logger {
  if (!rootLogger) rootLogger = pino({ level: 'info' });
  return rootLogger;
}

export function createLogger(component: string): pino.Logger {
  return getLogger().child({ component });
}

import { pinoHttp } from 'pino-http';
import { randomUUID } from 'crypto';
import { getLogger } from '../logger.js';
import type { IncomingMessage, ServerResponse } from 'http';

export function createRequestLogger() {
  return pinoHttp({
    logger: getLogger(),
    genReqId: (req: IncomingMessage, _res: ServerResponse) => {
      const requestId = req.headers['x-request-id'] ?? req.headers['x-correlation-id'];
      return (Array.isArray(requestId) ? requestId[0] : requestId) ?? randomUUID();
    },
    customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) => {
      if (err ?? res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  });
}

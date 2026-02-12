import postgres from 'postgres';
import { createLogger } from '../logger.js';

const log = createLogger('db');

export type Sql = postgres.Sql;
export type JsonValue = postgres.JSONValue;

export interface DbPoolOptions {
  max?: number;
  idleTimeout?: number;
  connectTimeout?: number;
}

export function createDb(connectionString: string, options: DbPoolOptions = {}): Sql {
  const { max = 20, idleTimeout = 20, connectTimeout = 10 } = options;

  const sql = postgres(connectionString, {
    max,
    idle_timeout: idleTimeout,
    connect_timeout: connectTimeout,
    onnotice: () => {
      // Suppress NOTICE messages from Postgres (e.g. during migrations)
    },
  });

  log.info({ max, idleTimeout, connectTimeout }, 'Pool created');

  return sql;
}

import postgres from 'postgres';

export type Sql = postgres.Sql;

export function createDb(connectionString: string): Sql {
  return postgres(connectionString, {
    max: 20,
    idle_timeout: 20,
    connect_timeout: 10,
  });
}

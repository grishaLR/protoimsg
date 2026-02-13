import type { Sql } from '../db/client.js';
import { createLogger } from '../logger.js';

const log = createLogger('global-bans');

/**
 * In-memory Set of globally banned DIDs, backed by the `global_bans` table.
 * Loaded once at startup for O(1) lookups on every auth request.
 */
export class GlobalBanService {
  private banned = new Set<string>();

  /** Load all banned DIDs from the database into memory. */
  async load(sql: Sql): Promise<void> {
    const rows = await sql<{ did: string }[]>`SELECT did FROM global_bans`;
    this.banned.clear();
    for (const row of rows) {
      this.banned.add(row.did);
    }
    log.info({ count: this.banned.size }, 'Loaded global bans');
  }

  /** O(1) check whether a DID is globally banned. */
  isBanned(did: string): boolean {
    return this.banned.has(did);
  }

  /** Ban a DID and persist to the database. */
  async add(
    sql: Sql,
    did: string,
    handle: string | null,
    reason: string | null,
    addedBy: string,
  ): Promise<void> {
    await sql`
      INSERT INTO global_bans (did, handle, reason, added_by)
      VALUES (${did}, ${handle}, ${reason}, ${addedBy})
      ON CONFLICT (did) DO UPDATE SET
        handle = EXCLUDED.handle,
        reason = EXCLUDED.reason,
        added_by = EXCLUDED.added_by
    `;
    this.banned.add(did);
    log.info({ did, handle, reason }, 'Global ban added');
  }

  /** Remove a global ban and delete from the database. */
  async remove(sql: Sql, did: string): Promise<void> {
    await sql`DELETE FROM global_bans WHERE did = ${did}`;
    this.banned.delete(did);
    log.info({ did }, 'Global ban removed');
  }
}

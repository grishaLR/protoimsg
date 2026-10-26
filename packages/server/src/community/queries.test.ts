import { describe, it, expect } from 'vitest';
import type { Sql } from '../db/client.js';
import { syncCommunityMembers } from './queries.js';

// Minimal postgres.js stand-in: tracks how many transactions are open at once.
function fakeSql(opts: { failFirst?: boolean } = {}) {
  let open = 0;
  let maxOpen = 0;
  let calls = 0;
  const order: string[] = [];
  const sql = Object.assign((rows: unknown) => rows, {
    begin: async (fn: (tx: unknown) => Promise<void>) => {
      const call = calls++;
      open++;
      maxOpen = Math.max(maxOpen, open);
      try {
        const tx = async (strings: TemplateStringsArray, ...values: unknown[]) => {
          await new Promise((r) => setTimeout(r, 1));
          if (strings.join('?').startsWith('DELETE')) order.push(String(values[0]));
          if (opts.failFirst && call === 0) throw new Error('boom');
        };
        await fn(tx);
      } finally {
        open--;
      }
    },
  });
  return { sql: sql as unknown as Sql, stats: () => ({ maxOpen, order }) };
}

const members = [{ did: 'did:plc:bob', addedAt: '2026-01-01T00:00:00Z' }];

describe('syncCommunityMembers', () => {
  it('runs concurrent syncs for the same owner one at a time', async () => {
    const { sql, stats } = fakeSql();
    await Promise.all(
      Array.from({ length: 10 }, () => syncCommunityMembers(sql, 'did:plc:alice', members)),
    );
    expect(stats().maxOpen).toBe(1);
  });

  it('runs syncs for different owners in parallel', async () => {
    const { sql, stats } = fakeSql();
    await Promise.all([
      syncCommunityMembers(sql, 'did:plc:alice', members),
      syncCommunityMembers(sql, 'did:plc:carol', members),
    ]);
    expect(stats().maxOpen).toBe(2);
  });

  it('keeps the queue moving after a failed sync', async () => {
    const { sql, stats } = fakeSql({ failFirst: true });
    const first = syncCommunityMembers(sql, 'did:plc:alice', members);
    const second = syncCommunityMembers(sql, 'did:plc:alice', members);
    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toBeUndefined();
    // First sync dies on the lock query before its DELETE; only the second gets that far.
    expect(stats().order).toEqual(['did:plc:alice']);
  });
});

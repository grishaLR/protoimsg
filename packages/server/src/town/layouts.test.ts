import { beforeEach, describe, it, expect, vi } from 'vitest';
import { TOWN_DEFAULT_LAYOUT, type TownPlacement } from '@protoimsg/shared';
import type { Sql } from '../db/client.js';
import { IndexedTownLayouts, placementsFromRecord, recordTime } from './layouts.js';

describe('placementsFromRecord', () => {
  it('reads a valid record', () => {
    expect(
      placementsFromRecord('home', {
        $type: 'app.protoimsg.town.layout',
        space: 'home',
        placements: [{ builtin: 'armchair', x: 3, y: 4 }],
        updatedAt: '2026-10-24T00:00:00Z',
      }),
    ).toEqual([{ builtin: 'armchair', x: 3, y: 4 }]);
  });

  it("ignores a record for another space or one that isn't a layout", () => {
    expect(
      placementsFromRecord('yard', { space: 'home', placements: TOWN_DEFAULT_LAYOUT.home }),
    ).toEqual([]);
    expect(placementsFromRecord('home', 'nope')).toEqual([]);
    expect(placementsFromRecord('home', null)).toEqual([]);
  });
});

// ── IndexedTownLayouts, over an in-memory "table" ─────────────────────────

const table = new Map<string, { placements: TownPlacement[]; at: number }>();
let readGate: Promise<void> | null = null;

vi.mock('./queries.js', () => ({
  getTownLayout: async (_sql: unknown, did: string, space: string) => {
    const row = table.get(`${did}|${space}`);
    if (readGate) await readGate;
    return row ? row.placements : null;
  },
  upsertTownLayout: (
    _sql: unknown,
    i: { did: string; space: string; placements: TownPlacement[]; updatedAt: Date },
  ) => {
    const k = `${i.did}|${i.space}`;
    const row = table.get(k);
    if (row && row.at > i.updatedAt.getTime()) return Promise.resolve(false);
    table.set(k, { placements: i.placements, at: i.updatedAt.getTime() });
    return Promise.resolve(true);
  },
  deleteTownLayout: (_sql: unknown, did: string, space: string) => {
    table.delete(`${did}|${space}`);
    return Promise.resolve();
  },
}));

const A = 'did:plc:a';
const sql = {} as Sql;
const chair = (x: number): TownPlacement => ({ builtin: 'armchair', x, y: 4 });
const record = (x: number, updatedAt: string) => ({
  space: 'home',
  placements: [chair(x)],
  updatedAt,
});

describe('IndexedTownLayouts', () => {
  beforeEach(() => {
    table.clear();
    readGate = null;
  });

  it('never lets an older record replace a newer one (late firehose event)', async () => {
    const layouts = new IndexedTownLayouts(sql, () => Promise.resolve(null));
    await layouts.apply(A, 'home', record(5, '2026-10-24T10:00:02Z'), 'cid2');
    await layouts.apply(A, 'home', record(3, '2026-10-24T10:00:01Z'), 'cid1');
    expect(layouts.get(A, 'home')).toEqual([chair(5)]);
  });

  it('shows the default for a record of the other space', async () => {
    const layouts = new IndexedTownLayouts(sql, () => Promise.resolve(null));
    await layouts.apply(A, 'yard', record(3, '2026-10-24T10:00:00Z'), 'cid');
    expect(layouts.get(A, 'yard')).toEqual(TOWN_DEFAULT_LAYOUT.yard);
  });

  it('reads the PDS once at a time per space, and once more for a save mid-read', async () => {
    let release: () => void = () => {};
    let calls = 0;
    const layouts = new IndexedTownLayouts(sql, async () => {
      calls++;
      if (calls === 1) await new Promise<void>((r) => (release = r));
      return { record: record(calls, `2026-10-24T10:00:0${String(calls)}Z`), cid: null };
    });
    const first = layouts.refresh(A, 'home');
    void layouts.refresh(A, 'home');
    void layouts.refresh(A, 'home');
    release();
    await first;
    expect(calls).toBe(2); // the in-flight read plus one trailing read
    expect(layouts.get(A, 'home')).toEqual([chair(2)]);
  });

  it("doesn't let a slow load undo a save that landed meanwhile", async () => {
    table.set(`${A}|home`, { placements: [chair(1)], at: 0 });
    let open: () => void = () => {};
    readGate = new Promise<void>((r) => (open = r));
    const layouts = new IndexedTownLayouts(sql, () => Promise.resolve(null));
    const loading = layouts.load(A, 'home');
    await layouts.apply(A, 'home', record(7, '2026-10-24T10:00:00Z'), null);
    open();
    await loading;
    expect(layouts.get(A, 'home')).toEqual([chair(7)]);
  });

  it('loads an unloaded space on first look and says when it arrives', async () => {
    table.set(`${A}|home`, { placements: [chair(2)], at: 0 });
    const layouts = new IndexedTownLayouts(sql, () => Promise.resolve(null));
    const changed = vi.fn();
    layouts.onChange = changed;
    expect(layouts.get(A, 'home')).toEqual(TOWN_DEFAULT_LAYOUT.home);
    await vi.waitFor(() => {
      expect(changed).toHaveBeenCalledWith(A, 'home');
    });
    expect(layouts.get(A, 'home')).toEqual([chair(2)]);
  });
});

describe('recordTime', () => {
  it("trusts the owner's clock only a little way ahead", () => {
    const now = Date.parse('2026-10-24T10:00:00Z');
    expect(recordTime({ updatedAt: '2026-10-24T09:00:00Z' }, now).getTime()).toBe(now - 3_600_000);
    expect(recordTime({ updatedAt: '2030-01-01T00:00:00Z' }, now).getTime()).toBe(now + 300_000);
    expect(recordTime({ updatedAt: 'soon' }, now).getTime()).toBe(now);
  });
});

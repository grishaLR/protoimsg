import { describe, it, expect, vi, afterEach } from 'vitest';
import { CommunityTownGraph, type TownGraphLoader } from './town-graph.js';

const A = 'did:plc:a';
const B = 'did:plc:b';
const C = 'did:plc:c';
const D = 'did:plc:d';

/** A loader over a fixed "who lists whom" table (owner → members). */
function loaderFor(lists: Record<string, string[]>): TownGraphLoader & {
  loadMembers: ReturnType<typeof vi.fn>;
} {
  const loadMembers = vi.fn((did: string) => Promise.resolve(new Set(lists[did] ?? [])));
  return {
    loadMembers,
    loadInnerOwners: () => Promise.resolve(new Set<string>()),
    loadOwners: (did: string) =>
      Promise.resolve(
        new Set(
          Object.entries(lists)
            .filter(([, members]) => members.includes(did))
            .map(([owner]) => owner),
        ),
      ),
  };
}

describe('CommunityTownGraph', () => {
  let graph: CommunityTownGraph;
  afterEach(() => {
    graph.dispose();
  });

  it('knows nothing about people it has not loaded (fail closed)', () => {
    graph = new CommunityTownGraph(loaderFor({ [A]: [B], [B]: [A] }));
    expect(graph.mutual(A, B)).toBe(false);
    expect(graph.gatesFor(B).size).toBe(0);
    expect(graph.friendOfFriend(A, B)).toBe(false);
  });

  it('derives gates, mutuals and friends of friends once loaded', async () => {
    // A ⇄ B ⇄ C are mutual chains; D lists A but A doesn't list D.
    graph = new CommunityTownGraph(loaderFor({ [A]: [B], [B]: [A, C], [C]: [B], [D]: [A] }));
    for (const d of [A, B, C, D]) await graph.acquire(d);
    expect([...graph.gatesFor(A)].sort()).toEqual([B, D]);
    expect(graph.mutual(A, B)).toBe(true);
    expect(graph.mutual(A, D)).toBe(false); // one-way
    expect(graph.friendOfFriend(A, C)).toBe(true); // through B
    expect(graph.friendOfFriend(C, A)).toBe(true);
    expect(graph.friendOfFriend(A, D)).toBe(false);
  });

  it('patches both sides when someone syncs their list, and says so', async () => {
    graph = new CommunityTownGraph(loaderFor({ [A]: [B], [B]: [A] }));
    await graph.acquire(A);
    await graph.acquire(B);
    const onChange = vi.fn();
    graph.onChange = onChange;

    graph.communityChanged(A, [], []);
    expect(graph.mutual(A, B)).toBe(false);
    expect(graph.gatesFor(B).has(A)).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);

    graph.communityChanged(A, [B], []);
    expect(graph.mutual(B, A)).toBe(true);
    expect(graph.gatesFor(B).has(A)).toBe(true);
  });

  it('shares one load between concurrent joins and drops the entry at zero refs', async () => {
    const loader = loaderFor({ [A]: [B], [B]: [A] });
    graph = new CommunityTownGraph(loader);
    await Promise.all([graph.acquire(A), graph.acquire(A)]);
    await graph.acquire(B);
    expect(loader.loadMembers).toHaveBeenCalledTimes(2); // A once, B once
    graph.release(A);
    expect(graph.mutual(A, B)).toBe(true); // one tab still in town
    graph.release(A);
    expect(graph.mutual(A, B)).toBe(false);
  });

  it('stays closed when loading fails', async () => {
    graph = new CommunityTownGraph({
      loadMembers: () => Promise.reject(new Error('db down')),
      loadInnerOwners: () => Promise.resolve(new Set<string>()),
      loadOwners: () => Promise.resolve(new Set([B])),
    });
    await graph.acquire(A);
    expect(graph.gatesFor(A).size).toBe(0);
  });
});

describe('CommunityTownGraph consistency', () => {
  let graph: CommunityTownGraph;
  afterEach(() => {
    graph.dispose();
  });

  it('needs both entries to agree on a mutual (stale side fails closed)', async () => {
    graph = new CommunityTownGraph(loaderFor({ [A]: [B], [B]: [A] }));
    await graph.acquire(A);
    expect(graph.mutual(A, B)).toBe(false); // B not loaded
    await graph.acquire(B);
    expect(graph.mutual(A, B)).toBe(true);
    expect(graph.mutual(B, A)).toBe(true);
  });

  it('does not wake the town for a change that touches nobody in it', async () => {
    graph = new CommunityTownGraph(loaderFor({ [A]: [B], [B]: [A] }));
    await graph.acquire(A);
    const onChange = vi.fn();
    graph.onChange = onChange;
    graph.communityChanged(C, [D], []);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('drops a load that raced a community change (no stale gate comes back)', async () => {
    const lists: Record<string, string[]> = { [A]: [B], [B]: [A] };
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let first = true;
    graph = new CommunityTownGraph({
      loadMembers: (d) => Promise.resolve(new Set(lists[d] ?? [])),
      loadInnerOwners: () => Promise.resolve(new Set<string>()),
      loadOwners: async (d) => {
        // Snapshot taken before the change, delivered after it.
        const snapshot = new Set(Object.keys(lists).filter((o) => (lists[o] ?? []).includes(d)));
        if (first) {
          first = false;
          await gate;
        }
        return snapshot;
      },
    });
    const pending = graph.acquire(B);
    lists[A] = [];
    graph.communityChanged(A, [], []);
    release();
    await pending;
    expect(graph.gatesFor(B).has(A)).toBe(false);
  });

  it('a failed load takes no reference', async () => {
    let fail = true;
    graph = new CommunityTownGraph({
      loadMembers: () => (fail ? Promise.reject(new Error('db')) : Promise.resolve(new Set([B]))),
      loadInnerOwners: () => Promise.resolve(new Set<string>()),
      loadOwners: () => Promise.resolve(new Set([B])),
    });
    expect(await graph.acquire(A)).toBe(false);
    fail = false;
    expect(await graph.acquire(A)).toBe(true);
    await graph.acquire(B);
    expect(graph.gatesFor(A).has(B)).toBe(true);
  });
});

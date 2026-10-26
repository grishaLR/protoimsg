import { describe, it, expect } from 'vitest';
import { TOWN_PROXIMITY } from '@protoimsg/shared';
import { assignRooms, buildClusters, type ClusterRules, type ProxNode } from './town-proximity.js';

const { joinRadius, leaveRadius, maxClusterSize, maxSpan } = TOWN_PROXIMITY;

// Mirrors TownRoom's baseline rules: distinct DIDs, everything else allowed.
function rules(overrides: Partial<ClusterRules> = {}): ClusterRules {
  return {
    eligible: () => true,
    compatible: (a, b) => a.did !== b.did,
    newLinkReady: () => true,
    ...overrides,
  };
}

// Open ground in the 'everyone' zone, well clear of the central bedroom.
const BASE = 200;

function node(id: number, x: number, y = BASE, roomId: string | null = null): ProxNode {
  return { id, did: `did:plc:${String(id)}`, x, y, roomId };
}

function ids(clusters: ProxNode[][]): number[][] {
  return clusters.map((c) => c.map((n) => n.id).sort((a, b) => a - b));
}

describe('buildClusters', () => {
  it('links two avatars within the join radius', () => {
    const clusters = buildClusters([node(1, BASE), node(2, BASE + joinRadius - 1)], rules());
    expect(ids(clusters)).toEqual([[1, 2]]);
  });

  it('does not link avatars beyond the join radius', () => {
    const clusters = buildClusters([node(1, BASE), node(2, BASE + joinRadius + 1)], rules());
    expect(clusters).toEqual([]);
  });

  it('keeps an existing link until the leave radius (hysteresis)', () => {
    const between = BASE + (joinRadius + leaveRadius) / 2;
    const linked = buildClusters([node(1, BASE, BASE, 'r'), node(2, between, BASE, 'r')], rules());
    expect(ids(linked)).toEqual([[1, 2]]);

    const fresh = buildClusters([node(1, BASE), node(2, between)], rules());
    expect(fresh).toEqual([]);

    const gone = buildClusters(
      [node(1, BASE, BASE, 'r'), node(2, BASE + leaveRadius + 1, BASE, 'r')],
      rules(),
    );
    expect(gone).toEqual([]);
  });

  it('holds a new link back until it has dwelled', () => {
    const pair = [node(1, BASE), node(2, BASE + 10)];
    expect(buildClusters(pair, rules({ newLinkReady: () => false }))).toEqual([]);
    // An existing room link is not subject to dwell.
    const inRoom = [node(1, BASE, BASE, 'r'), node(2, BASE + 10, BASE, 'r')];
    expect(ids(buildClusters(inRoom, rules({ newLinkReady: () => false })))).toEqual([[1, 2]]);
  });

  it('chains a mesh transitively (A–B–C share a cluster)', () => {
    const step = joinRadius - 10;
    const clusters = buildClusters(
      [node(1, BASE), node(2, BASE + step), node(3, BASE + step * 2)],
      rules(),
    );
    expect(ids(clusters)).toEqual([[1, 2, 3]]);
  });

  it('caps how far a chain can stretch from its seed', () => {
    const step = joinRadius - 10;
    const count = Math.ceil(maxSpan / step) + 3;
    const chain = Array.from({ length: count }, (_, i) => node(i + 1, BASE + i * step));
    const [first] = buildClusters(chain, rules());
    expect(first).toBeDefined();
    for (const n of first ?? []) expect(n.x - BASE).toBeLessThanOrEqual(maxSpan);
  });

  it('never pairs two sockets of the same DID, even through a bridge', () => {
    const step = joinRadius - 10;
    const a = node(1, BASE);
    const b = node(2, BASE + step);
    const a2 = { ...node(3, BASE + step * 2), did: a.did };
    expect(ids(buildClusters([a, b, a2], rules()))).toEqual([[1, 2]]);
  });

  it('checks compatibility against every member, not just direct links', () => {
    // 1 and 3 must never share a room (block, or a zone/circle rule).
    const step = joinRadius - 10;
    const compatible = (x: ProxNode, y: ProxNode) =>
      x.did !== y.did && !(new Set([x.id, y.id]).has(1) && new Set([x.id, y.id]).has(3));
    const clusters = buildClusters(
      [node(1, BASE), node(2, BASE + step), node(3, BASE + step * 2)],
      rules({ compatible }),
    );
    expect(ids(clusters)).toEqual([[1, 2]]);
  });

  it('skips ineligible avatars entirely', () => {
    const clusters = buildClusters(
      [node(1, BASE), node(2, BASE + 10)],
      rules({ eligible: (n) => n.id !== 2 }),
    );
    expect(clusters).toEqual([]);
  });

  it('caps a cluster at maxClusterSize', () => {
    const crowd = Array.from({ length: maxClusterSize + 3 }, (_, i) => node(i + 1, BASE + i));
    const clusters = buildClusters(crowd, rules());
    expect(clusters[0]).toHaveLength(maxClusterSize);
    expect(clusters.every((c) => c.length <= maxClusterSize)).toBe(true);
  });

  it('finds links across spatial-hash cell boundaries', () => {
    // Straddle a cell edge (cell size = leaveRadius).
    const edge = leaveRadius * 3;
    const clusters = buildClusters(
      [node(1, edge - 5, edge - 5), node(2, edge + 5, edge + 5)],
      rules(),
    );
    expect(ids(clusters)).toEqual([[1, 2]]);
  });
});

describe('assignRooms', () => {
  const fresh = () => {
    let n = 0;
    return () => `new${String(++n)}`;
  };

  it('mints a room for a brand-new cluster', () => {
    expect(assignRooms([[node(1, 0), node(2, 0)]], fresh())).toEqual(['new1']);
  });

  it('on merge, the larger side keeps its room', () => {
    const merged = [
      node(1, 0, 0, 'big'),
      node(2, 0, 0, 'big'),
      node(3, 0, 0, 'big'),
      node(4, 0, 0, 'small'),
      node(5, 0, 0, 'small'),
    ];
    expect(assignRooms([merged], fresh())).toEqual(['big']);
  });

  it('on split, the biggest fragment keeps the room and the rest get new ones', () => {
    const a = [node(1, 0, 0, 'r'), node(2, 0, 0, 'r'), node(3, 0, 0, 'r')];
    const b = [node(4, 0, 0, 'r'), node(5, 0, 0, 'r')];
    expect(assignRooms([b, a], fresh())).toEqual(['new1', 'r']);
  });
});

describe('buildClusters keeps conversations stable', () => {
  it('a newcomer never pushes an existing member out of their conversation', () => {
    // 1 is new (lowest id) and compatible with 2 but not 3; 2 and 3 already talk.
    const nodes = [
      { id: 1, did: 'did:plc:new', x: 0, y: 0, roomId: null },
      { id: 2, did: 'did:plc:b', x: 20, y: 0, roomId: 'r' },
      { id: 3, did: 'did:plc:d', x: 40, y: 0, roomId: 'r' },
    ];
    const clusters = buildClusters(nodes, {
      eligible: () => true,
      compatible: (a, b) => !(a.id === 1 && b.id === 3) && !(a.id === 3 && b.id === 1),
      newLinkReady: () => true,
    });
    expect(clusters.map((c) => c.map((n) => n.id).sort())).toEqual([[2, 3]]);
  });
});

describe('buildClusters inside a home (wholeScene)', () => {
  it('links everyone in the house regardless of distance, dwell or span', () => {
    const far = BASE + maxSpan * 3;
    const clusters = buildClusters(
      [node(1, BASE), node(2, far), node(3, BASE, far)],
      rules({ newLinkReady: () => false }),
      true,
    );
    expect(ids(clusters)).toEqual([[1, 2, 3]]);
  });

  it('still keeps incompatible people apart', () => {
    const blocked = (a: ProxNode, b: ProxNode) =>
      a.did !== b.did && !([a.id, b.id].includes(1) && [a.id, b.id].includes(3));
    const clusters = buildClusters(
      [node(1, BASE), node(2, BASE + 500), node(3, BASE + 900)],
      rules({ compatible: blocked }),
      true,
    );
    expect(ids(clusters)).toEqual([[1, 2]]);
  });
});

describe('buildClusters grace and "stay together"', () => {
  const far = BASE + leaveRadius + 50;

  it('holds an existing link past the leave radius while the grace lasts', () => {
    const pair = [node(1, BASE, BASE, 'r'), node(2, far, BASE, 'r')];
    expect(ids(buildClusters(pair, rules({ holdLink: () => true })))).toEqual([[1, 2]]);
    expect(buildClusters(pair, rules({ holdLink: () => false }))).toEqual([]);
  });

  it('never extends grace to people who were not already linked', () => {
    const pair = [node(1, BASE), node(2, far)];
    expect(buildClusters(pair, rules({ holdLink: () => true }))).toEqual([]);
  });

  it('keeps a stay-together link at any distance only when both chose it', () => {
    const veryFar = BASE + maxSpan * 4;
    const both = [
      { ...node(1, BASE, BASE, 'r'), stay: true },
      { ...node(2, veryFar, BASE, 'r'), stay: true },
    ];
    expect(ids(buildClusters(both, rules()))).toEqual([[1, 2]]);
    const one = [{ ...node(1, BASE, BASE, 'r'), stay: true }, node(2, veryFar, BASE, 'r')];
    expect(buildClusters(one, rules())).toEqual([]);
  });

  it('a stay-together link still respects blocks', () => {
    const both = [
      { ...node(1, BASE, BASE, 'r'), stay: true },
      { ...node(2, far, BASE, 'r'), stay: true },
    ];
    expect(buildClusters(both, rules({ compatible: () => false }))).toEqual([]);
  });
});

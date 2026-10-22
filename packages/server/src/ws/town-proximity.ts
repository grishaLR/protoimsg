import { TOWN_PROXIMITY, townZoneAtPixel } from '@protoimsg/shared';
import type { TownZone } from '@protoimsg/shared';

/** One socket's avatar as the proximity solver sees it. */
export interface ProxNode {
  id: number;
  did: string;
  x: number;
  y: number;
  /** Voice room this node is in right now, if any. */
  roomId: string | null;
}

export interface ClusterRules {
  /** Node may take part in voice at all (e.g. block list synced). */
  eligible(n: ProxNode): boolean;
  /**
   * May these two ever share a room? Checked against EVERY member of a
   * cluster, not just direct links — audio reaches the whole room, so a
   * stranger must not get in by linking through your friend.
   */
  compatible(a: ProxNode, b: ProxNode): boolean;
  /** A brand-new link (not yet sharing a room) has dwelled long enough. */
  newLinkReady(a: ProxNode, b: ProxNode): boolean;
}

export function zoneOf(n: ProxNode): TownZone {
  return townZoneAtPixel(n.x, n.y);
}

function dist2(a: ProxNode, b: ProxNode): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

/** Within join radius, not yet sharing a room — a candidate new link. */
export function isNewLinkCandidate(a: ProxNode, b: ProxNode): boolean {
  return (
    dist2(a, b) < TOWN_PROXIMITY.joinRadius ** 2 && !(a.roomId !== null && a.roomId === b.roomId)
  );
}

function linked(a: ProxNode, b: ProxNode, rules: ClusterRules): boolean {
  const d2 = dist2(a, b);
  // Hysteresis — an existing link holds until the wider leave radius.
  if (a.roomId !== null && a.roomId === b.roomId) return d2 < TOWN_PROXIMITY.leaveRadius ** 2;
  return d2 < TOWN_PROXIMITY.joinRadius ** 2 && rules.newLinkReady(a, b);
}

/** Candidate neighbour pairs via a spatial hash — O(N) instead of O(N²). */
function nearbyPairs(nodes: ProxNode[]): Array<[ProxNode, ProxNode]> {
  const cell = TOWN_PROXIMITY.leaveRadius;
  const grid = new Map<string, ProxNode[]>();
  const key = (cx: number, cy: number) => `${String(cx)},${String(cy)}`;
  for (const n of nodes) {
    const k = key(Math.floor(n.x / cell), Math.floor(n.y / cell));
    const bucket = grid.get(k);
    if (bucket) bucket.push(n);
    else grid.set(k, [n]);
  }
  const pairs: Array<[ProxNode, ProxNode]> = [];
  for (const a of nodes) {
    const cx = Math.floor(a.x / cell);
    const cy = Math.floor(a.y / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const b of grid.get(key(cx + dx, cy + dy)) ?? []) {
          if (a.id < b.id) pairs.push([a, b]);
        }
      }
    }
  }
  return pairs;
}

/**
 * Group avatars into voice clusters: connected components of the proximity
 * graph ("the mesh"), so A–B–C can all talk even if A and C are farther apart.
 *
 * Every pair inside a cluster must be `compatible`; a node that conflicts
 * with anyone already in a cluster is left out of it (and may seed its own).
 * Clusters are capped in size and in span (distance from the seed), so a
 * daisy chain can't stretch audio across the map. Only clusters of 2+ are
 * returned.
 */
export function buildClusters(nodes: ProxNode[], rules: ClusterRules): ProxNode[][] {
  const eligible = nodes.filter((n) => rules.eligible(n)).sort((a, b) => a.id - b.id);
  const adj = new Map<number, ProxNode[]>();
  for (const n of eligible) adj.set(n.id, []);
  for (const [a, b] of nearbyPairs(eligible)) {
    if (!linked(a, b, rules)) continue;
    adj.get(a.id)?.push(b);
    adj.get(b.id)?.push(a);
  }
  for (const list of adj.values()) list.sort((a, b) => a.id - b.id);

  const maxSpan2 = TOWN_PROXIMITY.maxSpan ** 2;
  const visited = new Set<number>();
  const clusters: ProxNode[][] = [];
  for (const seed of eligible) {
    if (visited.has(seed.id)) continue;
    visited.add(seed.id);
    const cluster = [seed];
    const queue = [seed];
    for (let cur = queue.shift(); cur; cur = queue.shift()) {
      for (const nb of adj.get(cur.id) ?? []) {
        if (cluster.length >= TOWN_PROXIMITY.maxClusterSize) break;
        if (visited.has(nb.id)) continue;
        if (dist2(seed, nb) > maxSpan2) continue;
        if (!cluster.every((m) => rules.compatible(m, nb))) continue;
        visited.add(nb.id);
        cluster.push(nb);
        queue.push(nb);
      }
    }
    if (cluster.length >= 2) clusters.push(cluster);
  }
  return clusters;
}

/**
 * Give each cluster a room, reusing existing rooms so the most people stay
 * connected: when clusters merge, the side with more members keeps its room;
 * when one splits, the biggest fragment keeps it. Returns roomIds aligned
 * with `clusters`, minting new ids via `freshId`.
 */
export function assignRooms(clusters: ProxNode[][], freshId: () => string): string[] {
  const candidates: Array<{ idx: number; roomId: string; count: number }> = [];
  clusters.forEach((cluster, idx) => {
    const counts = new Map<string, number>();
    for (const n of cluster) {
      if (n.roomId) counts.set(n.roomId, (counts.get(n.roomId) ?? 0) + 1);
    }
    for (const [roomId, count] of counts) candidates.push({ idx, roomId, count });
  });
  candidates.sort((a, b) => b.count - a.count || a.idx - b.idx);

  const result = new Array<string | null>(clusters.length).fill(null);
  const claimed = new Set<string>();
  for (const c of candidates) {
    if (result[c.idx] !== null || claimed.has(c.roomId)) continue;
    result[c.idx] = c.roomId;
    claimed.add(c.roomId);
  }
  return result.map((r) => r ?? freshId());
}

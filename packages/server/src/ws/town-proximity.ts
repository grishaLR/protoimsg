import { TOWN_PROXIMITY } from '@protoimsg/shared';

/** One socket's avatar as the proximity solver sees it. */
export interface ProxNode {
  id: number;
  did: string;
  x: number;
  y: number;
  /** Conversation this node is in right now, if any. */
  roomId: string | null;
  /** Chose "stay together" in its current conversation. */
  stay?: boolean;
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
  /**
   * An existing link that drifted past the leave radius: still within its
   * grace period? (Absent: no grace.)
   */
  holdLink?(a: ProxNode, b: ProxNode): boolean;
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

function sameRoom(a: ProxNode, b: ProxNode): boolean {
  return a.roomId !== null && a.roomId === b.roomId;
}

/** Both chose to stay together in the conversation they share. */
function stayLink(a: ProxNode, b: ProxNode): boolean {
  return sameRoom(a, b) && a.stay === true && b.stay === true;
}

function linked(a: ProxNode, b: ProxNode, rules: ClusterRules, wholeScene: boolean): boolean {
  if (wholeScene) return true;
  const d2 = dist2(a, b);
  if (sameRoom(a, b)) {
    if (stayLink(a, b)) return true;
    // Hysteresis — an existing link holds until the wider leave radius, and
    // past it for a short grace.
    return d2 < TOWN_PROXIMITY.leaveRadius ** 2 || (rules.holdLink?.(a, b) ?? false);
  }
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
 * Pairs already sharing a conversation, at any distance — grace and "stay
 * together" links can outlast the spatial hash's reach. Bounded by the
 * cluster cap.
 */
function roomPairs(nodes: ProxNode[]): Array<[ProxNode, ProxNode]> {
  const byRoom = new Map<string, ProxNode[]>();
  for (const n of nodes) {
    if (!n.roomId) continue;
    const list = byRoom.get(n.roomId);
    if (list) list.push(n);
    else byRoom.set(n.roomId, [n]);
  }
  return [...byRoom.values()].flatMap(allPairs);
}

/** Every pair — for scenes where distance doesn't matter. */
function allPairs(nodes: ProxNode[]): Array<[ProxNode, ProxNode]> {
  const pairs: Array<[ProxNode, ProxNode]> = [];
  for (const a of nodes) {
    for (const b of nodes) if (a.id < b.id) pairs.push([a, b]);
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
 *
 * `wholeScene` (inside a home) links everyone regardless of distance or
 * dwell: the house is one conversation. Compatibility and the size cap
 * still apply.
 */
export function buildClusters(
  nodes: ProxNode[],
  rules: ClusterRules,
  wholeScene = false,
): ProxNode[][] {
  // People already in a conversation seed first, so a newcomer can never
  // push an existing member out of theirs.
  const eligible = nodes
    .filter((n) => rules.eligible(n))
    .sort((a, b) => Number(a.roomId === null) - Number(b.roomId === null) || a.id - b.id);
  const adj = new Map<number, ProxNode[]>();
  for (const n of eligible) adj.set(n.id, []);
  const seen = new Set<string>();
  const pairs = wholeScene
    ? allPairs(eligible)
    : [...nearbyPairs(eligible), ...roomPairs(eligible)];
  for (const [a, b] of pairs) {
    const key = a.id < b.id ? `${String(a.id)}:${String(b.id)}` : `${String(b.id)}:${String(a.id)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!linked(a, b, rules, wholeScene)) continue;
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
      const here = cur.roomId;
      // Within a conversation, its current members are added before anyone new.
      const neighbours = [...(adj.get(cur.id) ?? [])].sort(
        (a, b) =>
          Number(here === null || a.roomId !== here) - Number(here === null || b.roomId !== here) ||
          a.id - b.id,
      );
      for (const nb of neighbours) {
        if (cluster.length >= TOWN_PROXIMITY.maxClusterSize) break;
        if (visited.has(nb.id)) continue;
        // "Stay together" is a choice both made — distance doesn't apply.
        if (!wholeScene && !stayLink(cur, nb) && dist2(seed, nb) > maxSpan2) continue;
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

// Shared scene model for proto town. Spaces are separate scenes, each its own
// server room: avatars, chat and voice only flow within a scene, so who can
// see you falls out of which scene you're in. The server needs the scene
// shapes too, to clamp positions and place arrivals.

export const TOWN_TILE = 32;

/**
 * - `home` — your private room. You spawn here; guests need you to let them in.
 * - `neighborhood` — outside your front door, behind a gate. Community only.
 * - `square` — the public town square outside every gate. Everyone.
 */
export type TownSceneKind = 'home' | 'neighborhood' | 'square';

export type TownScene = { kind: 'home' | 'neighborhood'; owner: string } | { kind: 'square' };

// ATProto DID syntax (method-specific id can't end in ':' or '%'), length-capped.
const DID_RE = /^did:[a-z]+:[a-zA-Z0-9._:%-]{0,2000}[a-zA-Z0-9._-]$/;

/** Wire id of a scene: `home:{did}`, `neighborhood:{did}` or `square`. */
export function townSceneId(scene: TownScene): string {
  return scene.kind === 'square' ? 'square' : `${scene.kind}:${scene.owner}`;
}

/** Inverse of `townSceneId`; null for anything malformed. */
export function parseTownSceneId(id: string): TownScene | null {
  if (id === 'square') return { kind: 'square' };
  const sep = id.indexOf(':');
  if (sep < 0) return null;
  const kind = id.slice(0, sep);
  const owner = id.slice(sep + 1);
  if ((kind === 'home' || kind === 'neighborhood') && DID_RE.test(owner)) {
    return { kind, owner };
  }
  return null;
}

/** A tile rect that, stepped on, takes you to another scene. */
export interface TownDoorway {
  x: number;
  y: number;
  w: number;
  h: number;
  to: TownSceneKind;
  /** Square gates: which slot of the gate row (see TOWN_SQUARE_LAYOUT). */
  slot?: number;
}

/** A neighborhood gate in the square, assigned to an owner by the server. */
export interface TownGate {
  owner: string;
  slot: number;
}

/** World-px arrival point and facing (Avatar DIR_*: 0 down, 1 left, 2 right, 3 up). */
export interface TownSpawn {
  x: number;
  y: number;
  dir: number;
}

export interface TownLayout {
  /** Size in tiles. */
  w: number;
  h: number;
  doorways: TownDoorway[];
  /** Where you appear, keyed by the scene kind you arrived from. */
  arrivals: Partial<Record<TownSceneKind, TownSpawn>>;
  /** Where you appear when joining fresh (or from an unlisted scene). */
  spawn: TownSpawn;
}

const DIR_DOWN = 0;
const DIR_UP = 3;

/** Centre of a tile row, between two door tiles starting at `fromX`. */
function between(fromX: number, ty: number, dir: number): TownSpawn {
  return { x: (fromX + 1) * TOWN_TILE, y: ty * TOWN_TILE + TOWN_TILE / 2, dir };
}

/** Home interior: back wall (2 rows), side walls, door in the bottom wall. */
export const TOWN_HOME_LAYOUT = {
  w: 14,
  h: 10,
  door: { x: 6, y: 9, w: 2, h: 1 },
} as const;

/** Neighborhood: forest edge, fenced yard, your house with its door and a gate out. */
export const TOWN_NEIGHBORHOOD_LAYOUT = {
  w: 32,
  h: 24,
  fence: { x: 1, y: 1, w: 30, h: 22 },
  gate: { x: 15, y: 22, w: 2, h: 1 },
  house: { x: 12, y: 8, w: 8, h: 4 },
  door: { x: 15, y: 11, w: 2, h: 1 },
} as const;

/**
 * Town square: a gate row along the top fence (one gate per neighborhood you
 * can enter, yours in the middle), a stone plaza with a fountain, and two lots
 * waiting for the arcade and the theater.
 */
export const TOWN_SQUARE_LAYOUT = {
  w: 40,
  h: 30,
  fenceY: 1,
  /** Left tile x of each two-tile gate slot. */
  gateSlots: [2, 6, 10, 14, 18, 22, 26, 30, 34],
  /** Your own neighborhood's gate. */
  ownSlot: 4,
  plaza: { x: 10, y: 8, w: 20, h: 14 },
  fountain: { x: 19, y: 14, w: 2, h: 2 },
  benches: [
    { x: 12, y: 10, w: 2, h: 1 },
    { x: 26, y: 10, w: 2, h: 1 },
    { x: 12, y: 19, w: 2, h: 1 },
    { x: 26, y: 19, w: 2, h: 1 },
  ],
  lots: {
    arcade: { x: 2, y: 10, w: 6, h: 8 },
    theater: { x: 32, y: 10, w: 6, h: 8 },
  },
  /** Stepping here lists every neighborhood you can visit. */
  signpost: { x: 24, y: 3 },
} as const;

/** Max gates the row shows (yours + others); the rest are on the signpost. */
export const TOWN_GATE_SLOTS = TOWN_SQUARE_LAYOUT.gateSlots.length;

const H = TOWN_HOME_LAYOUT;
const N = TOWN_NEIGHBORHOOD_LAYOUT;
const S = TOWN_SQUARE_LAYOUT;

export const TOWN_LAYOUTS: Record<TownSceneKind, TownLayout> = {
  home: {
    w: H.w,
    h: H.h,
    doorways: [{ ...H.door, to: 'neighborhood' }],
    arrivals: {},
    spawn: between(H.door.x, H.door.y - 1, DIR_UP),
  },
  neighborhood: {
    w: N.w,
    h: N.h,
    doorways: [
      { ...N.door, to: 'home' },
      { ...N.gate, to: 'square' },
    ],
    arrivals: { square: between(N.gate.x, N.gate.y - 1, DIR_UP) },
    // On the doormat, facing out.
    spawn: between(N.door.x, N.door.y + 1, DIR_DOWN),
  },
  square: {
    w: S.w,
    h: S.h,
    doorways: S.gateSlots.map((x, slot) => ({
      x,
      y: S.fenceY,
      w: 2,
      h: 1,
      to: 'neighborhood' as const,
      slot,
    })),
    arrivals: {},
    spawn: townGateArrival(S.ownSlot),
  },
};

/** Just inside the square, below gate `slot`, facing in. */
export function townGateArrival(slot: number): TownSpawn {
  const x =
    TOWN_SQUARE_LAYOUT.gateSlots[slot] ?? TOWN_SQUARE_LAYOUT.gateSlots[TOWN_SQUARE_LAYOUT.ownSlot];
  return between(x, TOWN_SQUARE_LAYOUT.fenceY + 1, DIR_DOWN);
}

/** Where you appear entering `to` from `from` (null = fresh join). */
export function townArrival(to: TownSceneKind, from: TownSceneKind | null): TownSpawn {
  const layout = TOWN_LAYOUTS[to];
  return (from && layout.arrivals[from]) || layout.spawn;
}

export function townDoorwayAtTile(kind: TownSceneKind, tx: number, ty: number): TownDoorway | null {
  for (const d of TOWN_LAYOUTS[kind].doorways) {
    if (tx >= d.x && tx < d.x + d.w && ty >= d.y && ty < d.y + d.h) return d;
  }
  return null;
}

/**
 * The scene a doorway leads to. Homes and neighborhoods come in pairs per
 * owner; a square gate leads to whoever owns its slot (null = an empty slot).
 */
export function townDoorwayTarget(
  from: TownScene,
  door: TownDoorway,
  gates: readonly TownGate[],
): TownScene | null {
  if (door.to === 'square') return { kind: 'square' };
  if (from.kind !== 'square') return { kind: door.to, owner: from.owner };
  const gate = gates.find((g) => g.slot === door.slot);
  return gate ? { kind: 'neighborhood', owner: gate.owner } : null;
}

/** Clamp a world-px position to a scene's bounds (one tile in from the edge). */
export function townClamp(kind: TownSceneKind, x: number, y: number): { x: number; y: number } {
  const { w, h } = TOWN_LAYOUTS[kind];
  const c = (v: number, hi: number) => Math.min(Math.max(v, TOWN_TILE), (hi - 1) * TOWN_TILE);
  return { x: c(x, w), y: c(y, h) };
}

/** How long a knock waits for an answer before it's "no answer". */
export const TOWN_KNOCK_MS = 30_000;

/** How long a request to join a conversation waits for everyone's answer. */
export const TOWN_JOIN_ASK_MS = 30_000;

/**
 * Area of interest, in world px: the server only sends you avatars within
 * this box around you (comfortably larger than the viewport at 2× zoom on a
 * large monitor). Keeps move fan-out O(neighbours), not O(everyone).
 */
export const TOWN_VIEW = { halfWidth: 720, halfHeight: 480 } as const;

/**
 * Proximity voice ("aura mesh") radii, in world px. Two avatars link when they
 * come within JOIN and stay linked until they drift past LEAVE — the gap is
 * hysteresis so standing at the edge doesn't flap the audio room.
 */
export const TOWN_PROXIMITY = {
  joinRadius: 96,
  leaveRadius: 132,
  /** Max avatars sharing one voice room — bounds LiveKit fan-out per cluster. */
  maxClusterSize: 12,
  /** Max distance from a cluster's seed — stops daisy chains spanning the map. */
  maxSpan: 288,
} as const;

// Shared geometry for proto town — the server needs the zones too, so it can
// hide avatars that are home and keep voice out of there.

export const TOWN_TILE = 48;
export const TOWN_MAP_W = 40;
export const TOWN_MAP_H = 30;

// Interim zones until homes/gated communities become their own scenes. The
// walled centre stands in for your home (inner circle) — nobody sees or hears
// you there. Around it, a fenced neighborhood that will become your gated
// community; for now it's as open as the public world outside the gate. Walls
// and fence block movement except at the door and gate (the door is where
// knocking will happen). Later rects win.
export type TownZone = 'public' | 'neighborhood' | 'home';

export interface TownZoneRect {
  zone: TownZone;
  x: number;
  y: number;
  w: number;
  h: number;
}

function centeredZone(
  halfW: number,
  halfH: number,
): { x: number; y: number; w: number; h: number } {
  return { x: TOWN_MAP_W / 2 - halfW, y: TOWN_MAP_H / 2 - halfH, w: halfW * 2, h: halfH * 2 };
}

/** Fenced neighborhood (tile rect; the fence runs along its edge). */
export const TOWN_NEIGHBORHOOD_RECT = centeredZone(15, 11);
/** Walled home (tile rect; the walls run along its edge). */
export const TOWN_HOME_RECT = centeredZone(5, 4);

/** Gaps in the bottom edge: tile x range [from, to] of the gate / door. */
const bottomGap = (r: { x: number; w: number }) => ({
  from: r.x + r.w / 2 - 1,
  to: r.x + r.w / 2,
});
export const TOWN_GATE = {
  ...bottomGap(TOWN_NEIGHBORHOOD_RECT),
  y: TOWN_NEIGHBORHOOD_RECT.y + TOWN_NEIGHBORHOOD_RECT.h - 1,
};
export const TOWN_DOOR = {
  ...bottomGap(TOWN_HOME_RECT),
  y: TOWN_HOME_RECT.y + TOWN_HOME_RECT.h - 1,
};

export const TOWN_ZONE_RECTS: TownZoneRect[] = [
  { zone: 'public', x: 0, y: 0, w: TOWN_MAP_W, h: TOWN_MAP_H },
  { zone: 'neighborhood', ...TOWN_NEIGHBORHOOD_RECT },
  { zone: 'home', ...TOWN_HOME_RECT },
];

export type TownBarrier = 'wall' | 'fence';

/**
 * The barrier (if any) on a tile: the edge ring of the home rect is wall, the
 * edge ring of the neighborhood rect is fence, minus the door and gate gaps.
 */
export function townBarrierAtTile(tx: number, ty: number): TownBarrier | null {
  const onEdge = (r: { x: number; y: number; w: number; h: number }) =>
    tx >= r.x &&
    tx < r.x + r.w &&
    ty >= r.y &&
    ty < r.y + r.h &&
    (tx === r.x || tx === r.x + r.w - 1 || ty === r.y || ty === r.y + r.h - 1);
  const inGap = (g: { from: number; to: number; y: number }) =>
    ty === g.y && tx >= g.from && tx <= g.to;
  if (onEdge(TOWN_HOME_RECT)) return inGap(TOWN_DOOR) ? null : 'wall';
  if (onEdge(TOWN_NEIGHBORHOOD_RECT)) return inGap(TOWN_GATE) ? null : 'fence';
  return null;
}

/** Innermost zone containing a tile. */
export function townZoneAtTile(tx: number, ty: number): TownZone {
  let zone: TownZone = 'public';
  for (const r of TOWN_ZONE_RECTS) {
    if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) zone = r.zone;
  }
  return zone;
}

export function townZoneAtPixel(px: number, py: number): TownZone {
  return townZoneAtTile(Math.floor(px / TOWN_TILE), Math.floor(py / TOWN_TILE));
}

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

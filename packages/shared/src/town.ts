// Shared geometry for proto town — the server needs the zones too, so it can
// keep proximity voice out of the private (bedroom) zone.

export const TOWN_TILE = 48;
export const TOWN_MAP_W = 40;
export const TOWN_MAP_H = 30;

// Concentric visibility zones — your position in town is who can see you.
// Innermost is most private; later (smaller) rects win.
export type TownZone = 'everyone' | 'community' | 'inner' | 'bedroom';

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

export const TOWN_ZONE_RECTS: TownZoneRect[] = [
  { zone: 'everyone', x: 0, y: 0, w: TOWN_MAP_W, h: TOWN_MAP_H },
  { zone: 'community', ...centeredZone(15, 11) },
  { zone: 'inner', ...centeredZone(8, 6) },
  { zone: 'bedroom', ...centeredZone(5, 4) },
];

/** Innermost zone containing a tile. */
export function townZoneAtTile(tx: number, ty: number): TownZone {
  let zone: TownZone = 'everyone';
  for (const r of TOWN_ZONE_RECTS) {
    if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) zone = r.zone;
  }
  return zone;
}

export function townZoneAtPixel(px: number, py: number): TownZone {
  return townZoneAtTile(Math.floor(px / TOWN_TILE), Math.floor(py / TOWN_TILE));
}

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

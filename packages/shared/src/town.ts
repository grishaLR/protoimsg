// Shared geometry for proto town — the server needs the zones too, so it can
// hide avatars that are home and keep voice out of there.

export const TOWN_TILE = 48;
export const TOWN_MAP_W = 40;
export const TOWN_MAP_H = 30;

// Interim zones until homes/gated communities become their own scenes (see
// GATHER_PLAN.md): the open map is the public world — visible to everyone,
// open proximity voice — and the centre square stands in for your home,
// where nobody sees or hears you. Later rects win.
export type TownZone = 'public' | 'home';

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
  { zone: 'public', x: 0, y: 0, w: TOWN_MAP_W, h: TOWN_MAP_H },
  { zone: 'home', ...centeredZone(5, 4) },
];

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

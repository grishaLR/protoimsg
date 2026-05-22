// Map definition for proto town (slice 1).
// Ground is a uniform grass layer; objects are placed sprites from the
// ansimuz "RPG Town" CC0 pack with per-type collision footprints.

export const TILE = 48;
export const MAP_W = 40;
export const MAP_H = 30;
export const OBJ_SCALE = 2; // collage objects are 16-px base art

export const ASSET_BASE = '/assets/town/town_rpg_pack';

export type TownObjectType = 'pine' | 'pond';

export interface PlacedObject {
  type: TownObjectType;
  tx: number;
  ty: number;
}

// Native crop sizes of each object PNG (pre-OBJ_SCALE).
export const OBJECT_ART: Record<TownObjectType, { w: number; h: number }> = {
  pine: { w: 15, h: 82 },
  pond: { w: 60, h: 46 },
};

function buildObjects(): PlacedObject[] {
  const objs: PlacedObject[] = [];
  // Perimeter forest.
  for (let x = 0; x < MAP_W; x += 2) {
    objs.push({ type: 'pine', tx: x, ty: 0 });
    objs.push({ type: 'pine', tx: x, ty: MAP_H - 1 });
  }
  for (let y = 2; y < MAP_H - 1; y += 2) {
    objs.push({ type: 'pine', tx: 0, ty: y });
    objs.push({ type: 'pine', tx: MAP_W - 1, ty: y });
  }
  // A loose grove.
  for (const [x, y] of [
    [8, 7],
    [10, 6],
    [12, 9],
    [9, 11],
    [13, 6],
    [7, 9],
  ]) {
    objs.push({ type: 'pine', tx: x ?? 0, ty: y ?? 0 });
  }
  // A pond.
  objs.push({ type: 'pond', tx: 27, ty: 17 });
  return objs;
}

export const OBJECTS: PlacedObject[] = buildObjects();

// Concentric visibility zones — your position in town is who can see you.
// Innermost is most private; the engine stacks them outer→inner so the
// smaller rings draw on top.
export type TownZone = 'everyone' | 'community' | 'inner' | 'bedroom';

export interface ZoneRect {
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
  return { x: MAP_W / 2 - halfW, y: MAP_H / 2 - halfH, w: halfW * 2, h: halfH * 2 };
}

export const ZONE_RECTS: ZoneRect[] = [
  { zone: 'everyone', x: 0, y: 0, w: MAP_W, h: MAP_H },
  { zone: 'community', ...centeredZone(15, 11) },
  { zone: 'inner', ...centeredZone(8, 6) },
  { zone: 'bedroom', ...centeredZone(5, 4) },
];

/** Innermost zone containing a tile — later (smaller) rects win. */
export function zoneAtTile(tx: number, ty: number): TownZone {
  let zone: TownZone = 'everyone';
  for (const r of ZONE_RECTS) {
    if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) zone = r.zone;
  }
  return zone;
}

export function zoneAtPixel(px: number, py: number): TownZone {
  return zoneAtTile(Math.floor(px / TILE), Math.floor(py / TILE));
}

// Tile footprint of an object, anchored at its placement tile.
function footprint(o: PlacedObject): Array<[number, number]> {
  if (o.type === 'pine') return [[o.tx, o.ty]];
  // Pond: 120x92 world px ≈ 3x2 tiles from its top-left tile.
  const cells: Array<[number, number]> = [];
  for (let dx = 0; dx < 3; dx++) {
    for (let dy = 0; dy < 2; dy++) cells.push([o.tx + dx, o.ty + dy]);
  }
  return cells;
}

const BLOCKED = new Set<string>();
for (const o of OBJECTS) {
  for (const [x, y] of footprint(o)) BLOCKED.add(`${x},${y}`);
}

export function isBlockedTile(tx: number, ty: number): boolean {
  if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) return true;
  return BLOCKED.has(`${tx},${ty}`);
}

export function isBlockedAtPixel(px: number, py: number): boolean {
  return isBlockedTile(Math.floor(px / TILE), Math.floor(py / TILE));
}

// Per-scene maps for proto town: size, collision, and the fixed scenery (the
// forest edge, the yard's well). Everything is drawn from the OpenPixels
// sheet (openpixels.ts, structures.ts). Scene sizes and doorways live in
// @protoimsg/shared so the server sees the same shapes.

import {
  TOWN_HOME_LAYOUT,
  TOWN_LAYOUTS,
  TOWN_NEIGHBORHOOD_LAYOUT,
  TOWN_SQUARE_LAYOUT,
  TOWN_TILE,
  townBuiltin,
  townDoorwayAtTile,
  townFootprint,
} from '@protoimsg/shared';
import type { TownPlacement, TownSceneKind, TownSpace } from '@protoimsg/shared';

export const TILE = TOWN_TILE;
export const OBJ_SCALE = 2; // the ansimuz pack's 16-px sprites (the pumpkins)

export const ASSET_BASE = '/assets/town/town_rpg_pack';

/** Placeable pieces with a pack sprite of their own (one PNG each, in objects/). */
export const SPRITE_PIECES = ['pumpkins'] as const;

export type TownObjectType = 'pine' | 'pond';

export interface PlacedObject {
  type: TownObjectType;
  tx: number;
  ty: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function inRect(r: Rect, tx: number, ty: number): boolean {
  return tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h;
}

function onEdge(r: Rect, tx: number, ty: number): boolean {
  return (
    inRect(r, tx, ty) && (tx === r.x || tx === r.x + r.w - 1 || ty === r.y || ty === r.y + r.h - 1)
  );
}

/** Square gate slot (if any) whose doorway covers a tile. */
export function gateSlotAt(tx: number, ty: number): number | null {
  return townDoorwayAtTile('square', tx, ty)?.slot ?? null;
}

/**
 * Pines every other tile around the map edge. `openBottom` leaves the bottom
 * row bare — tall pines there would hide a fence (and gate) just above them.
 */
function perimeterForest(w: number, h: number, openBottom = false): PlacedObject[] {
  const objs: PlacedObject[] = [];
  for (let x = 0; x < w; x += 2) {
    objs.push({ type: 'pine', tx: x, ty: 0 });
    if (!openBottom) objs.push({ type: 'pine', tx: x, ty: h - 1 });
  }
  for (let y = 2; y < h - 1; y += 2) {
    objs.push({ type: 'pine', tx: 0, ty: y });
    objs.push({ type: 'pine', tx: w - 1, ty: y });
  }
  return objs;
}

function pines(cells: Array<[number, number]>): PlacedObject[] {
  return cells.map(([tx, ty]) => ({ type: 'pine', tx, ty }));
}

// ── Designed spaces ─────────────────────────────────────────────────────

/** The space a scene's owner designs, if any (the square is everyone's). */
export function sceneSpace(kind: TownSceneKind): TownSpace | null {
  return kind === 'home' ? 'home' : kind === 'neighborhood' ? 'yard' : null;
}

/** Tiles covered by solid placements in a layout. */
export function layoutBlocks(placements: readonly TownPlacement[]): Set<string> {
  const out = new Set<string>();
  for (const p of placements) {
    const def = townBuiltin(p.builtin);
    const fp = townFootprint(p);
    if (!def?.solid || !fp) continue;
    for (let dx = 0; dx < fp.w; dx++) {
      for (let dy = 0; dy < fp.h; dy++) out.add(`${String(p.x + dx)},${String(p.y + dy)}`);
    }
  }
  return out;
}

// ── Barriers ────────────────────────────────────────────────────────────

export type Barrier = 'wall' | 'fence' | 'house';

/** The barrier on a tile in a scene, if any. Doorways are always open. */
export function barrierAt(kind: TownSceneKind, tx: number, ty: number): Barrier | null {
  if (townDoorwayAtTile(kind, tx, ty)) return null;
  if (kind === 'home') {
    const H = TOWN_HOME_LAYOUT;
    // Back wall is two rows tall; the rest of the ring is one tile.
    if (ty <= 1 || onEdge({ x: 0, y: 0, w: H.w, h: H.h }, tx, ty)) return 'wall';
    return null;
  }
  if (kind === 'neighborhood') {
    const N = TOWN_NEIGHBORHOOD_LAYOUT;
    if (inRect(N.house, tx, ty)) return 'house';
    if (onEdge(N.fence, tx, ty)) return 'fence';
    return null;
  }
  const S = TOWN_SQUARE_LAYOUT;
  // A fence run along the top; gate slots are doorways (closed ones are
  // blocked by the engine, which knows the gate row).
  if (ty === S.fenceY && tx >= 1 && tx < S.w - 1) return 'fence';
  return null;
}

// ── Scene maps ──────────────────────────────────────────────────────────

export interface SceneMap {
  kind: TownSceneKind;
  w: number;
  h: number;
  /** Canvas colour around the map. */
  background: number;
  /** Grass underfoot (false = an indoor floor, drawn by structures). */
  outdoors: boolean;
  objects: PlacedObject[];
  isBlockedTile(tx: number, ty: number): boolean;
}

function buildSceneMap(
  kind: TownSceneKind,
  background: number,
  outdoors: boolean,
  objects: PlacedObject[],
): SceneMap {
  const { w, h } = TOWN_LAYOUTS[kind];
  const blocked = new Set<string>();
  const block = (x: number, y: number) => blocked.add(`${String(x)},${String(y)}`);
  for (const o of objects) {
    if (o.type === 'pine') block(o.tx, o.ty);
    else {
      // Pond: 120x92 world px ≈ 3x2 tiles from its top-left tile.
      for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 2; dy++) block(o.tx + dx, o.ty + dy);
    }
  }
  if (kind === 'square') {
    const S = TOWN_SQUARE_LAYOUT;
    for (const r of [S.fountain, ...S.benches]) {
      for (let dx = 0; dx < r.w; dx++) for (let dy = 0; dy < r.h; dy++) block(r.x + dx, r.y + dy);
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) if (barrierAt(kind, x, y)) block(x, y);
  }
  if (kind === 'neighborhood') {
    // Outside the fence is scenery: the gate is the only way out.
    const f = TOWN_NEIGHBORHOOD_LAYOUT.fence;
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        if (x < f.x || x >= f.x + f.w || y < f.y || y >= f.y + f.h) block(x, y);
      }
    }
  }
  return {
    kind,
    w,
    h,
    background,
    outdoors,
    objects,
    isBlockedTile: (tx, ty) =>
      tx < 0 || tx >= w || ty < 0 || ty >= h || blocked.has(`${String(tx)},${String(ty)}`),
  };
}

const N = TOWN_NEIGHBORHOOD_LAYOUT;
const S = TOWN_SQUARE_LAYOUT;

/** Around an outdoor map: a deeper shade of the sheet's grass. */
const GRASS_EDGE = 0x5f9446;

export const SCENE_MAPS: Record<TownSceneKind, SceneMap> = {
  // Lamplit evening indoors — the warm dark beyond the walls frames the room.
  home: buildSceneMap('home', 0x241a14, false, []),
  neighborhood: buildSceneMap('neighborhood', GRASS_EDGE, true, [
    // Inside the fence is the owner's to design (their layout); the pond stays.
    ...perimeterForest(N.w, N.h, true),
    { type: 'pond', tx: 23, ty: 15 },
  ]),
  square: buildSceneMap('square', GRASS_EDGE, true, [
    // No tree right behind a gate: its opening has to read as a way through.
    ...perimeterForest(S.w, S.h).filter(
      (o) => !(o.ty === 0 && S.gateSlots.some((x) => o.tx >= x && o.tx <= x + 1)),
    ),
    ...pines([
      [4, 22],
      [7, 25],
      [33, 23],
      [36, 26],
      [16, 25],
      [24, 26],
    ]),
  ]),
};

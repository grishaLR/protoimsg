// Designing your own spaces in proto town: what can be placed, where, and
// the rules every layout must satisfy. Shared so the server (which checks
// other people's layouts before showing them) and the client (which previews
// your edits) agree on exactly the same answer.
//
// A layout is an `app.protoimsg.town.layout` record in its owner's repo
// (record key `home` or `yard`). Each placement is a starter object from the
// catalog below, or — once rpg.actor items can be world objects — an
// `equipment.rpg.item` the owner holds.

import { TOWN_HOME_LAYOUT, TOWN_NEIGHBORHOOD_LAYOUT } from './town.js';

export const TOWN_LAYOUT_COLLECTION = 'app.protoimsg.town.layout';

/** A space you can design: your home's room, or your neighborhood yard. */
export type TownSpace = 'home' | 'yard';

/** Most placements a layout may hold (matches the lexicon's maxLength). */
export const TOWN_MAX_PLACEMENTS = 200;

export interface TownPlacement {
  /** A starter object id from TOWN_BUILTINS. */
  builtin?: string;
  /** An equipment.rpg.item world object in the owner's repo (not drawn yet). */
  item?: string;
  x: number;
  y: number;
  /** Quarter turns clockwise (0–3); only pieces that `rotate` keep one. */
  rotation?: number;
}

export interface TownBuiltin {
  /** Tiles it covers, from its top-left tile. */
  w: number;
  h: number;
  /** Blocks walking (and other solid objects). Rugs and flower beds don't. */
  solid: boolean;
  /** Where it can go. */
  spaces: readonly TownSpace[];
  /** Can be turned (a lamp or a round bush looks the same every way). */
  rotates: boolean;
}

/** Starter objects every space can use, until rpg.actor world objects arrive. */
export const TOWN_BUILTINS = {
  bed: { w: 2, h: 3, solid: true, spaces: ['home'], rotates: true },
  nightstand: { w: 1, h: 1, solid: true, spaces: ['home'], rotates: false },
  couch: { w: 3, h: 1, solid: true, spaces: ['home'], rotates: true },
  armchair: { w: 1, h: 1, solid: true, spaces: ['home'], rotates: true },
  table: { w: 2, h: 1, solid: true, spaces: ['home', 'yard'], rotates: true },
  bookshelf: { w: 1, h: 2, solid: true, spaces: ['home'], rotates: true },
  plant: { w: 1, h: 1, solid: true, spaces: ['home', 'yard'], rotates: false },
  rug: { w: 6, h: 3, solid: false, spaces: ['home'], rotates: true },
  pine: { w: 1, h: 1, solid: true, spaces: ['yard'], rotates: false },
  bush: { w: 1, h: 1, solid: true, spaces: ['yard'], rotates: false },
  flowerbed: { w: 2, h: 1, solid: false, spaces: ['yard'], rotates: true },
  bench: { w: 2, h: 1, solid: true, spaces: ['yard'], rotates: true },
  lamppost: { w: 1, h: 1, solid: true, spaces: ['yard'], rotates: false },
  // From the ansimuz "RPG Town" pack (CC0), like the pines and the pond.
  pumpkins: { w: 1, h: 1, solid: true, spaces: ['yard'], rotates: false },
  garden: { w: 2, h: 2, solid: false, spaces: ['yard'], rotates: false },
  boulder: { w: 1, h: 1, solid: true, spaces: ['yard'], rotates: false },
  stone: { w: 1, h: 1, solid: false, spaces: ['yard'], rotates: false },
  chest: { w: 1, h: 1, solid: true, spaces: ['home', 'yard'], rotates: false },
  barrel: { w: 1, h: 1, solid: true, spaces: ['home', 'yard'], rotates: false },
  wildflowers: { w: 1, h: 1, solid: false, spaces: ['yard'], rotates: false },
} as const satisfies Record<string, TownBuiltin>;

export type TownBuiltinId = keyof typeof TOWN_BUILTINS;

export function townBuiltin(id: string | undefined): TownBuiltin | null {
  if (!id || !Object.hasOwn(TOWN_BUILTINS, id)) return null;
  return TOWN_BUILTINS[id as TownBuiltinId];
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A placement's quarter turns, as the rules see it (0 for pieces that don't turn). */
export function townRotation(p: Pick<TownPlacement, 'builtin' | 'rotation'>): number {
  const def = townBuiltin(p.builtin);
  if (!def?.rotates || !Number.isInteger(p.rotation)) return 0;
  return (((p.rotation ?? 0) % 4) + 4) % 4;
}

/** Tiles a placement covers, turned: a quarter turn swaps width and height. */
export function townFootprint(
  p: Pick<TownPlacement, 'builtin' | 'rotation'>,
): { w: number; h: number } | null {
  const def = townBuiltin(p.builtin);
  if (!def) return null;
  return townRotation(p) % 2 === 1 ? { w: def.h, h: def.w } : { w: def.w, h: def.h };
}

const H = TOWN_HOME_LAYOUT;
const N = TOWN_NEIGHBORHOOD_LAYOUT;

/** Tiles you may build on: the room's floor; the yard inside the fence. */
export const TOWN_BUILD_AREA: Record<TownSpace, Rect> = {
  // Inside the walls (the back wall is two rows tall).
  home: { x: 1, y: 2, w: H.w - 2, h: H.h - 3 },
  // Inside the fence ring.
  yard: { x: N.fence.x + 1, y: N.fence.y + 1, w: N.fence.w - 2, h: N.fence.h - 2 },
};

function rectTiles(r: Rect): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let dx = 0; dx < r.w; dx++) for (let dy = 0; dy < r.h; dy++) out.push([r.x + dx, r.y + dy]);
  return out;
}

const key = (x: number, y: number) => `${String(x)},${String(y)}`;

/**
 * Tiles that must stay walkable: in a home, the floor just inside the door;
 * in a yard, the house, the doormat, the path to the gate and the pond.
 * Only the tiles themselves: right up against the path is fair game, since
 * the reachability rule already keeps every open tile walkable.
 */
export const TOWN_KEEP_CLEAR: Record<TownSpace, ReadonlySet<string>> = {
  home: new Set(
    rectTiles({ x: H.door.x, y: H.door.y - 1, w: H.door.w, h: 1 }).map(([x, y]) => key(x, y)),
  ),
  yard: new Set(
    [
      ...rectTiles(N.house),
      // Doormat, then the path down to the gate.
      ...rectTiles({ x: N.door.x, y: N.door.y + 1, w: N.door.w, h: N.gate.y - N.door.y - 1 }),
      // The pond (a fixed feature of every yard).
      ...rectTiles({ x: 23, y: 15, w: 3, h: 2 }),
    ].map(([x, y]) => key(x, y)),
  ),
};

/** Fixed obstacles inside a space's build area (the yard's house and pond). */
const FIXED_BLOCKS: Record<TownSpace, ReadonlySet<string>> = {
  home: new Set(),
  yard: new Set(
    [...rectTiles(N.house), ...rectTiles({ x: 23, y: 15, w: 3, h: 2 })].map(([x, y]) => key(x, y)),
  ),
};

/** Where everyone walks in from: the open keep-clear tiles (door strip, path). */
const ENTRY: Record<TownSpace, string[]> = {
  home: [...TOWN_KEEP_CLEAR.home].filter((t) => !FIXED_BLOCKS.home.has(t)),
  yard: [...TOWN_KEEP_CLEAR.yard].filter((t) => !FIXED_BLOCKS.yard.has(t)),
};

/**
 * Every open tile of the build area can still be walked to from the way in.
 * Nobody can be walled into a corner, or out of part of a space.
 */
function allReachable(space: TownSpace, solid: ReadonlySet<string>): boolean {
  const area = TOWN_BUILD_AREA[space];
  const fixed = FIXED_BLOCKS[space];
  const open = (x: number, y: number): boolean => {
    const k = key(x, y);
    return (
      x >= area.x &&
      y >= area.y &&
      x < area.x + area.w &&
      y < area.y + area.h &&
      !solid.has(k) &&
      !fixed.has(k)
    );
  };
  const seen = new Set<string>();
  const stack: Array<[number, number]> = [];
  for (const t of ENTRY[space]) {
    const [x, y] = t.split(',').map(Number) as [number, number];
    if (open(x, y) && !seen.has(t)) {
      seen.add(t);
      stack.push([x, y]);
    }
  }
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) break;
    const [x, y] = next;
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ] as const) {
      const k = key(nx, ny);
      if (seen.has(k) || !open(nx, ny)) continue;
      seen.add(k);
      stack.push([nx, ny]);
    }
  }
  let openCount = 0;
  for (const [x, y] of rectTiles(area)) if (open(x, y)) openCount++;
  return seen.size === openCount;
}

/** What a space looks like before its owner has designed it. */
export const TOWN_DEFAULT_LAYOUT: Record<TownSpace, TownPlacement[]> = {
  home: [
    { builtin: 'rug', x: 4, y: 4 },
    { builtin: 'bed', x: 1, y: 2 },
    { builtin: 'nightstand', x: 3, y: 2 },
    { builtin: 'couch', x: 8, y: 2 },
    { builtin: 'bookshelf', x: 12, y: 2 },
    { builtin: 'plant', x: 12, y: 8 },
    { builtin: 'plant', x: 1, y: 8 },
  ],
  yard: [
    { builtin: 'pine', x: 4, y: 4 },
    { builtin: 'pine', x: 6, y: 3 },
    { builtin: 'pine', x: 26, y: 4 },
    { builtin: 'pine', x: 27, y: 7 },
    { builtin: 'pine', x: 5, y: 18 },
  ],
};

/**
 * Keep what a layout may show, in order: known starter objects that fit the
 * space, stay on buildable tiles, leave the keep-clear tiles walkable, and
 * don't overlap another solid object, and never wall off part of the space
 * (every open tile stays reachable from the door). Anything else is dropped, never
 * "fixed" (a later valid placement isn't affected by an earlier bad one).
 * Owned rpg.actor items are skipped until they can describe themselves as
 * world objects.
 */
export function validateTownLayout(space: TownSpace, placements: unknown): TownPlacement[] {
  if (!Array.isArray(placements)) return [];
  const area = TOWN_BUILD_AREA[space];
  const clear = TOWN_KEEP_CLEAR[space];
  const solid = new Set<string>();
  const kept: TownPlacement[] = [];
  for (const raw of placements.slice(0, TOWN_MAX_PLACEMENTS)) {
    if (!raw || typeof raw !== 'object') continue;
    const p = raw as Record<string, unknown>;
    const { x, y } = p;
    if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
    const px = x as number;
    const py = y as number;
    const builtin = typeof p.builtin === 'string' ? p.builtin : undefined;
    const def = townBuiltin(builtin);
    if (!def?.spaces.includes(space)) continue;
    const rotation = townRotation({ builtin, rotation: p.rotation as number | undefined });
    const fp = rotation % 2 === 1 ? { w: def.h, h: def.w } : { w: def.w, h: def.h };
    if (px < area.x || py < area.y || px + fp.w > area.x + area.w || py + fp.h > area.y + area.h) {
      continue;
    }
    const tiles = rectTiles({ x: px, y: py, w: fp.w, h: fp.h }).map(([tx, ty]) => key(tx, ty));
    if (tiles.some((t) => clear.has(t))) continue;
    if (def.solid) {
      if (tiles.some((t) => solid.has(t))) continue;
      const next = new Set(solid);
      for (const t of tiles) next.add(t);
      if (!allReachable(space, next)) continue;
      for (const t of tiles) solid.add(t);
    }
    kept.push({ builtin: p.builtin as string, x: px, y: py, ...(rotation ? { rotation } : {}) });
  }
  return kept;
}

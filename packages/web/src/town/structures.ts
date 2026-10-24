import { Container, Graphics, type Sprite } from 'pixi.js';
import {
  TOWN_HOME_LAYOUT,
  TOWN_NEIGHBORHOOD_LAYOUT,
  TOWN_SQUARE_LAYOUT,
  TOWN_TILE,
  townBuiltin,
  townFootprint,
  townRotation,
} from '@protoimsg/shared';
import type { TownGate, TownPlacement, TownSceneKind } from '@protoimsg/shared';
import { barrierAt, gateSlotAt } from './map';
import { ART_SCALE, PIECE_FRAMES, type FrameId, type OpenPixels } from './openpixels';

// Each scene's walls, fence, house and ground, composed from the OpenPixels
// sheet (see openpixels.ts). The bench and lamppost are still hand-drawn on
// a 16-px grid scaled 3×, until open art turns up for them.
const U = TOWN_TILE / 16;
const T = TOWN_TILE;

const WOOD = 0x6b4426;
const WOOD_DARK = 0x4a2e19;
const LAMP_SHADE = 0xf5d48f;
const LAMP_GLOW = 0xffc477;
const WINDOW_LIT = 0xf2c46b;
const WINDOW_LIT_HOT = 0xfbe3a4;
const IRON = 0x3a3646;
const IRON_LIGHT = 0x58536a;

/** Pixel-grid rect: units of U inside the tile at (tx, ty). */
function px(
  g: Graphics,
  tx: number,
  ty: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
): void {
  g.rect(tx * T + x * U, ty * T + y * U, w * U, h * U).fill(color);
}

/** Depth for something standing on tile row `ty`: sorts with whoever's there. */
const rowZ = (ty: number): number => (ty + 1) * T - 1;
const GROUND_Z = -4500;
const FLOOR_Z = -10000;
const RUG_Z = -4400;

/** A frame on a tile, its depth set by the row it stands on. */
function tileSprite(art: OpenPixels, id: FrameId, tx: number, ty: number, flip = false): Sprite {
  const s = art.sprite(id, tx * T, ty * T, flip);
  s.zIndex = rowZ(ty);
  return s;
}

// ── Hand-drawn pieces (no open art yet) ─────────────────────────────────

function drawBench(g: Graphics, r: { x: number; y: number; w: number }): void {
  for (let i = 0; i < r.w; i++) {
    const l = i === 0 ? 1 : 0;
    const right = i === r.w - 1 ? 15 : 16;
    px(g, r.x + i, r.y, l, 3, right - l, 3, WOOD);
    px(g, r.x + i, r.y, l, 7, right - l, 3, WOOD);
    px(g, r.x + i, r.y, l, 6, right - l, 1, WOOD_DARK);
    px(g, r.x + i, r.y, l, 10, right - l, 1, WOOD_DARK);
  }
  px(g, r.x, r.y, 2, 11, 2, 4, WOOD_DARK); // legs
  px(g, r.x + r.w - 1, r.y, 12, 11, 2, 4, WOOD_DARK);
}

function drawLamppost(g: Graphics, x: number, y: number): void {
  // A tall post: the lantern stands well above its tile.
  px(g, x, y, 5, 13, 6, 3, IRON); // foot
  px(g, x, y, 7, -12, 2, 25, IRON);
  px(g, x, y, 4, -18, 8, 7, IRON);
  px(g, x, y, 5, -17, 6, 5, LAMP_SHADE);
  px(g, x, y, 6, -20, 4, 2, IRON_LIGHT);
}

// ── Placed pieces ───────────────────────────────────────────────────────

/**
 * One placed piece. Pieces with sheet art are sprites: centred on their
 * tiles, and a piece taller than its tiles stands on the bottom row (a plant,
 * a nightstand against the wall). Turned pieces turn about their centre.
 * Null for pieces drawn elsewhere (the pumpkins' own sprite) or unknown ones.
 */
export function drawPlacement(art: OpenPixels | null, p: TownPlacement): Container | null {
  const def = townBuiltin(p.builtin);
  const fp = townFootprint(p);
  if (!def || !fp || !p.builtin) return null;
  const z = def.solid ? rowZ(p.y + fp.h - 1) : RUG_Z;
  const frames = PIECE_FRAMES[p.builtin];
  if (frames && art) {
    const node = new Container();
    let x = 0;
    for (const id of frames) {
      const s = art.sprite(id, x, 0);
      x += s.width;
      node.addChild(s);
    }
    const w = node.width;
    const h = node.height;
    const turns = townRotation(p);
    const cx = (p.x + fp.w / 2) * T;
    node.pivot.set(w / 2, h / 2);
    node.rotation = (turns * Math.PI) / 2;
    // Unturned and taller than its tiles: stand it on the bottom row.
    const tall = turns === 0 && h > fp.h * T;
    const cy = tall ? (p.y + fp.h) * T - h / 2 - 2 : (p.y + fp.h / 2) * T;
    node.position.set(cx, cy);
    node.zIndex = z;
    return node;
  }
  if (p.builtin === 'bench' || p.builtin === 'lamppost') {
    const g = new Graphics();
    if (p.builtin === 'lamppost') drawLamppost(g, 0, 0);
    else drawBench(g, { x: 0, y: 0, w: def.w });
    // Drawn unturned at the origin, then turned and moved onto its tiles.
    const turns = townRotation(p);
    g.pivot.set((def.w * T) / 2, (def.h * T) / 2);
    g.rotation = (turns * Math.PI) / 2;
    g.position.set((p.x + fp.w / 2) * T, (p.y + fp.h / 2) * T);
    g.zIndex = z;
    return g;
  }
  return null;
}

// More lamps than this add no light, only work.
const MAX_LAMPS = 8;

/**
 * Lamplight from every nightstand in a home: many faint stacked pools, so
 * the falloff reads as a glow rather than rings. Null when there's no lamp.
 */
export function buildLampGlow(placements: readonly TownPlacement[]): Container | null {
  const lamps = placements.filter((p) => p.builtin === 'nightstand').slice(0, MAX_LAMPS);
  if (lamps.length === 0) return null;
  const glow = new Graphics();
  for (const lamp of lamps) {
    const lx = lamp.x * T + T / 2;
    const ly = lamp.y * T + T / 3;
    // About three tiles of light, fading out.
    for (let r = 3.3 * T; r > 0.4 * T; r -= 0.3 * T) {
      glow.circle(lx, ly, r).fill({ color: LAMP_GLOW, alpha: 0.022 });
    }
  }
  glow.zIndex = 100_000; // over everything, it's light
  glow.eventMode = 'none';
  return glow;
}

// ── Walls (home) ────────────────────────────────────────────────────────

/** A horizontal wall run on row `ty`, from tile x0 up to (not incl.) x1. */
function wallRun(art: OpenPixels, x0: number, x1: number, ty: number, out: Container[]): void {
  for (let tx = x0; tx < x1; tx++) {
    const id: FrameId =
      tx === x0 ? 'wallL' : tx === x1 - 1 ? 'wallR' : tx % 2 === 0 ? 'wallM1' : 'wallM2';
    out.push(tileSprite(art, id, tx, ty));
  }
}

/** A vertical wall run down column `tx`: the same pieces, turned a quarter. */
function wallColumn(art: OpenPixels, tx: number, y0: number, y1: number, out: Container[]): void {
  for (let ty = y0; ty < y1; ty++) {
    const id: FrameId =
      ty === y0 ? 'wallL' : ty === y1 - 1 ? 'wallR' : ty % 2 === 0 ? 'wallM1' : 'wallM2';
    const s = art.sprite(id, 0, 0);
    s.anchor.set(0.5);
    s.rotation = Math.PI / 2;
    s.position.set(tx * T + T / 2, ty * T + T / 2);
    s.zIndex = rowZ(ty);
    out.push(s);
  }
}

function buildHome(art: OpenPixels): Container[] {
  const H = TOWN_HOME_LAYOUT;
  const out: Container[] = [];
  const floor = art.tiled('floor', 1, 2, H.w - 2, H.h - 3);
  floor.zIndex = FLOOR_Z;
  const doorway = art.tiled('floor', H.door.x, H.door.y, H.door.w, 1);
  doorway.zIndex = FLOOR_Z;
  out.push(floor, doorway);
  for (let tx = H.door.x; tx < H.door.x + H.door.w; tx++) {
    const mat = art.sprite('mat', tx * T, (H.door.y - 1) * T);
    mat.zIndex = GROUND_Z;
    out.push(mat);
  }
  // Back wall: the run along the top, wallpaper below it.
  wallRun(art, 0, H.w, 0, out);
  for (let tx = 1; tx < H.w - 1; tx++) {
    const id: FrameId = tx === 1 ? 'paperL' : tx === H.w - 2 ? 'paperR' : 'paperM';
    out.push(tileSprite(art, id, tx, 1));
  }
  // Sides, then the front either side of the door.
  wallColumn(art, 0, 1, H.h, out);
  wallColumn(art, H.w - 1, 1, H.h, out);
  wallRun(art, 1, H.door.x, H.door.y, out);
  wallRun(art, H.door.x + H.door.w, H.w - 1, H.door.y, out);
  return out;
}

// ── Outdoors ────────────────────────────────────────────────────────────

/** Fence on every fence tile: horizontal runs, or vertical ones on the sides. */
function buildFence(
  art: OpenPixels,
  kind: TownSceneKind,
  w: number,
  h: number,
  isVertical: (tx: number, ty: number) => boolean,
  isClosedGate: (tx: number, ty: number) => boolean = () => false,
): Container[] {
  const out: Container[] = [];
  for (let tx = 0; tx < w; tx++) {
    for (let ty = 0; ty < h; ty++) {
      if (barrierAt(kind, tx, ty) !== 'fence' && !isClosedGate(tx, ty)) continue;
      if (isVertical(tx, ty)) {
        const s = art.sprite('fenceV', 0, ty * T);
        s.x = tx * T + (T - s.width) / 2;
        s.zIndex = rowZ(ty);
        out.push(s);
      } else {
        const s = art.sprite('fenceH', tx * T, 0);
        s.y = ty * T + T - s.height - 4;
        s.zIndex = rowZ(ty);
        out.push(s);
      }
    }
  }
  return out;
}

/**
 * The neighborhood house: the sheet's cottage, widened by repeating its
 * middle. Two roof rows; the upper wall carries the windows, and the door
 * (a double door, one leaf per doorway tile) spans both wall rows.
 */
function buildHouse(art: OpenPixels): Container[] {
  const { house, door } = TOWN_NEIGHBORHOOD_LAYOUT;
  const out: Container[] = [];
  const left: FrameId[] = ['houseL0', 'houseL1', 'houseL2', 'houseL3'];
  const right: FrameId[] = ['houseR0', 'houseR1', 'houseR2', 'houseR3'];
  const middle = (row: number, col: number): FrameId => {
    if (row === 0) return col % 2 === 1 ? 'roofA0' : 'roofB0';
    if (row === 1) return col % 2 === 1 ? 'roofA1' : 'roofB1';
    return row === 2 ? 'wallUpper' : 'wallLower';
  };
  for (let row = 0; row < house.h; row++) {
    const ty = house.y + row;
    for (let col = 0; col < house.w; col++) {
      const tx = house.x + col;
      const id = col === 0 ? left[row] : col === house.w - 1 ? right[row] : middle(row, col);
      if (id) out.push(tileSprite(art, id, tx, ty));
    }
  }
  const upper = house.y + house.h - 2;
  for (const col of [1, house.w - 3]) out.push(tileSprite(art, 'window', house.x + col, upper));
  for (let tx = door.x; tx < door.x + door.w; tx++) {
    out.push(tileSprite(art, 'doorTop', tx, upper), tileSprite(art, 'door', tx, door.y));
  }
  return out;
}

function buildNeighborhood(art: OpenPixels): Container[] {
  const N = TOWN_NEIGHBORHOOD_LAYOUT;
  // A sand path from the front door down to the gate.
  const path = art.tiled('sand', N.gate.x, N.door.y + 1, N.gate.w, N.gate.y - N.door.y);
  path.zIndex = GROUND_Z;
  const out: Container[] = [path];
  const f = N.fence;
  return [
    ...out,
    ...buildHouse(art),
    ...buildFence(
      art,
      'neighborhood',
      N.w,
      N.h,
      (tx, ty) => (tx === f.x || tx === f.x + f.w - 1) && ty !== f.y && ty !== f.y + f.h - 1,
    ),
  ];
}

function buildSquare(
  art: OpenPixels,
  openSlots: ReadonlySet<number>,
  hasSignpost: boolean,
): Container[] {
  const S = TOWN_SQUARE_LAYOUT;
  const ground: Container[] = [art.tiled('pavement', S.plaza.x, S.plaza.y, S.plaza.w, S.plaza.h)];
  // A walk along the gate row, and one down to the plaza.
  const first = Math.min(...S.gateSlots);
  const last = Math.max(...S.gateSlots) + 1;
  ground.push(art.tiled('sand', first, S.fenceY + 1, last - first + 1, 2));
  ground.push(art.tiled('sand', 19, S.fenceY + 3, 2, S.plaza.y - S.fenceY - 3));
  // Lots waiting for the arcade and the theater: bare earth.
  for (const lot of [S.lots.arcade, S.lots.theater]) {
    ground.push(art.tiled('sand', lot.x, lot.y, lot.w, lot.h));
  }
  for (const g of ground) g.zIndex = GROUND_Z;

  const fountain = art.sprite('well', 0, 0);
  fountain.position.set(
    (S.fountain.x + S.fountain.w / 2) * T - fountain.width / 2,
    (S.fountain.y + S.fountain.h) * T - fountain.height,
  );
  fountain.zIndex = rowZ(S.fountain.y + S.fountain.h - 1);
  const benches = S.benches.map((b) => {
    const g = new Graphics();
    drawBench(g, b);
    g.zIndex = rowZ(b.y);
    return g;
  });
  // The signpost only stands when it has neighborhoods to list.
  const signpost: Container[] = [];
  if (hasSignpost) {
    const s = art.sprite('sign', 0, 0);
    s.position.set((S.signpost.x + 0.5) * T - s.width / 2, (S.signpost.y + 1) * T - s.height);
    s.zIndex = rowZ(S.signpost.y);
    signpost.push(s);
  }
  return [
    ...ground,
    fountain,
    ...benches,
    ...signpost,
    ...buildFence(
      art,
      'square',
      S.w,
      S.h,
      () => false,
      (tx, ty) => {
        const slot = gateSlotAt(tx, ty);
        return slot !== null && !openSlots.has(slot);
      },
    ),
  ];
}

/**
 * Build a scene's structures. Each piece's zIndex is the base of the row it
 * stands on, so avatars depth-sort correctly in front of / behind it.
 */
export function buildStructures(
  art: OpenPixels,
  kind: TownSceneKind,
  openSlots: ReadonlySet<number> = new Set(),
  hasSignpost = false,
): Container[] {
  if (kind === 'home') return buildHome(art);
  if (kind === 'neighborhood') return buildNeighborhood(art);
  return buildSquare(art, openSlots, hasSignpost);
}

/**
 * Warm light in the house's front windows (and a soft spill on the wall and
 * grass below), shown while the owner is home and visible to you.
 */
export function buildWindowGlow(): Container {
  const { house } = TOWN_NEIGHBORHOOD_LAYOUT;
  const ty = house.y + house.h - 2; // the window row
  const g = new Graphics();
  for (const col of [1, house.w - 3]) {
    // Light through the shutters, in the window frame's art pixels.
    const x = (house.x + col) * T + 13 * ART_SCALE;
    const y = ty * T + 4 * ART_SCALE;
    const w = 31 * ART_SCALE;
    const h = 13 * ART_SCALE;
    g.rect(x, y, w, h).fill({ color: WINDOW_LIT, alpha: 0.45 });
    g.rect(x, y, w, h / 3).fill({ color: WINDOW_LIT_HOT, alpha: 0.4 });
    for (let r = 1.2 * T; r > 0.2 * T; r -= 0.2 * T) {
      g.circle(x + w / 2, y + h / 2, r).fill({ color: LAMP_GLOW, alpha: 0.05 });
    }
  }
  // Just above the house's window row, so it sits over the glass.
  g.zIndex = (ty + 1) * T;
  g.eventMode = 'none';
  return g;
}

/**
 * A floating sign in the world. Ids name what it labels: a door by where it
 * leads, a square gate by its owner, a lot, or the signpost.
 */
export type SignId =
  | `door:${TownSceneKind}`
  | `gate:${string}`
  | 'lot:arcade'
  | 'lot:theater'
  | 'signpost';

export interface SignSpec {
  id: SignId;
  x: number;
  y: number;
  /** 0 = text hangs below the point, 0.5 = centred on it, 1 = sits above it. */
  anchorY: number;
}

const HL = TOWN_HOME_LAYOUT;
const NL = TOWN_NEIGHBORHOOD_LAYOUT;
const SL = TOWN_SQUARE_LAYOUT;

/** The signs a scene shows (the square's depend on its gate row). */
export function sceneSigns(
  kind: TownSceneKind,
  gates: readonly TownGate[],
  hasMore: boolean,
): SignSpec[] {
  if (kind === 'home') {
    // On the door itself — just above it is where you stand (and your name tag).
    return [
      {
        id: 'door:neighborhood',
        x: (HL.door.x + 1) * TOWN_TILE,
        y: (HL.door.y + 0.5) * TOWN_TILE,
        anchorY: 0.5,
      },
    ];
  }
  if (kind === 'neighborhood') {
    return [
      {
        id: 'door:home',
        x: (NL.house.x + NL.house.w / 2) * TOWN_TILE,
        y: NL.house.y * TOWN_TILE - 4,
        anchorY: 1,
      },
      {
        id: 'door:square',
        x: (NL.gate.x + 1) * TOWN_TILE,
        y: (NL.gate.y + 0.5) * TOWN_TILE,
        anchorY: 0.5,
      },
    ];
  }
  const signs: SignSpec[] = gates.map((g) => ({
    id: `gate:${g.owner}`,
    x: ((SL.gateSlots[g.slot] ?? 0) + 1) * TOWN_TILE,
    // Beyond the gate: you arrive just inside it, facing away.
    y: SL.fenceY * TOWN_TILE + 2,
    anchorY: 1,
  }));
  for (const [id, lot] of [
    ['lot:arcade', SL.lots.arcade],
    ['lot:theater', SL.lots.theater],
  ] as const) {
    signs.push({ id, x: (lot.x + lot.w / 2) * TOWN_TILE, y: lot.y * TOWN_TILE - 2, anchorY: 1 });
  }
  if (hasMore) {
    signs.push({
      id: 'signpost',
      x: (SL.signpost.x + 0.5) * TOWN_TILE,
      y: SL.signpost.y * TOWN_TILE - 2,
      anchorY: 1,
    });
  }
  return signs;
}

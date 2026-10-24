import { Container, Graphics } from 'pixi.js';
import {
  TOWN_HOME_LAYOUT,
  TOWN_NEIGHBORHOOD_LAYOUT,
  TOWN_SQUARE_LAYOUT,
  TOWN_TILE,
} from '@protoimsg/shared';
import { townBuiltin, townFootprint, townRotation } from '@protoimsg/shared';
import type { TownGate, TownPlacement, TownSceneKind } from '@protoimsg/shared';
import { barrierAt, gateSlotAt } from './map';

// Procedural pixel art for each scene's walls, fence, house and furniture
// (the pieces people place in their own spaces),
// drawn on a 16-px grid scaled 3× so it matches the CC0 town pack (48-px tiles).
const U = TOWN_TILE / 16;

const STONE = 0x7d7468;
const STONE_LIGHT = 0xa59a8a;
const PICKET = 0xf1ebdf;
const PICKET_SHADE = 0xb9b09f;
const WOOD = 0x6b4426;
const WOOD_DARK = 0x4a2e19;
const MAT = 0x8a5a33;
const MAT_STRIPE = 0xb07a47;
const PATH = 0xcbb894;
const PATH_EDGE = 0xa8956f;

// Home interior — lamplit evening: warm floorboards, papered walls.
const PLANK = 0x9a6a3e;
const PLANK_SEAM = 0x7a5030;
const PLANK_LIGHT = 0xad7a49;
const WALLPAPER = 0xe6cfa6;
const WALLPAPER_STRIPE = 0xd8bd8f;
const WAINSCOT = 0x7f5233;
const WAINSCOT_LIGHT = 0x9a6740;
const WALL_CAP = 0x4e3626;
const WALL_CAP_EDGE = 0x6a4a34;
const NIGHT = 0x2b2f5a;
const NIGHT_DEEP = 0x1f2244;
const MOON = 0xf3e9c6;
const QUILT = 0x7a5cc4;
const QUILT_SHADE = 0x5f45a0;
const LINEN = 0xf2e8d8;
const COUCH = 0x6e8f7a;
const COUCH_SHADE = 0x557363;
const LEAF = 0x5f9a4e;
const LEAF_DARK = 0x467a3a;
const POT = 0xb4643c;
const RUG = 0xa4473f;
const RUG_BORDER = 0xd8a35a;
const BOOKS = [0x8b5cf6, 0xc7553e, 0x3f7cac, 0xd8a35a, 0x5f9a4e];
const LAMP_SHADE = 0xf5d48f;
const ARMCHAIR = 0xc0794a;
const ARMCHAIR_SHADE = 0x9a5c35;
const BLOOMS = [0xe86f8a, 0xf2c14e, 0xf4f0e6, 0x9b7be0];
const IRON = 0x3a3646;
const IRON_LIGHT = 0x58536a;
const LAMP_GLOW = 0xffc477;
const WINDOW_LIT = 0xf2c46b;
const WINDOW_LIT_HOT = 0xfbe3a4;

// House exterior — plum roof (the one place the brand purple lives outdoors).
const ROOF = 0x6e4a7e;
const ROOF_DARK = 0x553a63;
const ROOF_RIDGE = 0x8a64a0;
const SIDING = 0xe9dcc3;
const SIDING_LINE = 0xcdbd9f;
const TRIM = 0xf7f1e6;
const GLASS = 0x3b4a6b;
const DOOR = 0x7a4a2a;
const DOOR_DARK = 0x5a341c;
const BRASS = 0xe0b04a;
const CHIMNEY = 0x8c5a48;

// Town square — warm stone plaza, a fountain at its heart.
const FLAG = 0xd9cdb6;
const FLAG_LIGHT = 0xe7ddca;
const FLAG_JOINT = 0xb3a68d;
const WATER = 0x5aa6c8;
const WATER_LIGHT = 0xa8dcef;
const DIRT = 0xa98a62;
const DIRT_DARK = 0x8c6f4b;
const STAKE = 0xe8dcc4;

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
  g.rect(tx * TOWN_TILE + x * U, ty * TOWN_TILE + y * U, w * U, h * U).fill(color);
}

/** A Graphics depth-sorted at the bottom edge of tile row `ty`. */
function rowPiece(ty: number): Graphics {
  const g = new Graphics();
  g.zIndex = (ty + 1) * TOWN_TILE - 1;
  return g;
}

/** Ground layer: under everything that walks. */
function groundPiece(z = -4500): Graphics {
  const g = new Graphics();
  g.zIndex = z;
  return g;
}

// ── Shared outdoor pieces ───────────────────────────────────────────────

function drawFence(g: Graphics, tx: number, ty: number, vertical: boolean): void {
  if (vertical) {
    // Side runs: rails down the middle, picket caps along them.
    px(g, tx, ty, 6, 0, 1, 16, PICKET_SHADE);
    px(g, tx, ty, 9, 0, 1, 16, PICKET_SHADE);
    for (let y = 1; y < 16; y += 4) px(g, tx, ty, 5, y, 6, 2, PICKET);
    return;
  }
  // Front/back runs: two rails with pointed pickets.
  px(g, tx, ty, 0, 7, 16, 1, PICKET_SHADE);
  px(g, tx, ty, 0, 11, 16, 1, PICKET_SHADE);
  for (let x = 1; x < 16; x += 4) {
    px(g, tx, ty, x, 4, 2, 10, PICKET);
    px(g, tx, ty, x, 3, 1, 1, PICKET); // pointed tip
    px(g, tx, ty, x + 1, 13, 1, 1, PICKET_SHADE);
  }
}

function drawGatePost(g: Graphics, tx: number, ty: number, side: 'left' | 'right'): void {
  const x = side === 'left' ? 11 : 1;
  px(g, tx, ty, x, 1, 4, 14, STONE);
  px(g, tx, ty, x, 1, 4, 2, STONE_LIGHT);
}

function drawMat(g: Graphics, tx: number, ty: number): void {
  px(g, tx, ty, 1, 9, 14, 6, MAT);
  for (let x = 2; x < 15; x += 3) px(g, tx, ty, x, 10, 1, 4, MAT_STRIPE);
}

function drawPath(g: Graphics, tx: number, ty: number): void {
  px(g, tx, ty, 1, 1, 6, 6, PATH);
  px(g, tx, ty, 9, 2, 6, 5, PATH);
  px(g, tx, ty, 2, 9, 5, 6, PATH);
  px(g, tx, ty, 9, 9, 6, 6, PATH);
  px(g, tx, ty, 1, 6, 6, 1, PATH_EDGE);
  px(g, tx, ty, 9, 14, 6, 1, PATH_EDGE);
}

/** Fence tiles of a scene, with stone posts either side of each gate gap. */
function buildFence(
  kind: TownSceneKind,
  w: number,
  h: number,
  gates: ReadonlyArray<{ x: number; y: number; w: number }>,
  isVertical: (tx: number, ty: number) => boolean,
  isClosedGate: (tx: number, ty: number) => boolean = () => false,
): Graphics[] {
  const out: Graphics[] = [];
  for (let tx = 0; tx < w; tx++) {
    for (let ty = 0; ty < h; ty++) {
      if (barrierAt(kind, tx, ty) !== 'fence' && !isClosedGate(tx, ty)) continue;
      const g = rowPiece(ty);
      drawFence(g, tx, ty, isVertical(tx, ty));
      for (const gate of gates) {
        if (ty === gate.y && tx === gate.x - 1) drawGatePost(g, tx, ty, 'left');
        if (ty === gate.y && tx === gate.x + gate.w) drawGatePost(g, tx, ty, 'right');
      }
      out.push(g);
    }
  }
  return out;
}

// ── House exterior (neighborhood) ───────────────────────────────────────

function drawRoof(g: Graphics, tx: number, ty: number, row: number, rows: number): void {
  px(g, tx, ty, 0, 0, 16, 16, ROOF);
  // Staggered shingle courses.
  for (let y = 0; y < 16; y += 4) {
    px(g, tx, ty, 0, y + 3, 16, 1, ROOF_DARK);
    const offset = (y / 4 + row) % 2 === 0 ? 2 : 6;
    for (let x = offset; x < 16; x += 8) px(g, tx, ty, x, y, 1, 3, ROOF_DARK);
  }
  if (row === 0) px(g, tx, ty, 0, 0, 16, 2, ROOF_RIDGE);
  // Eave shadow on the siding below.
  if (row === rows - 1) px(g, tx, ty, 0, 14, 16, 2, ROOF_DARK);
}

function drawSiding(g: Graphics, tx: number, ty: number): void {
  px(g, tx, ty, 0, 0, 16, 16, SIDING);
  for (let y = 3; y < 16; y += 4) px(g, tx, ty, 0, y, 16, 1, SIDING_LINE);
}

function drawHouseWindow(g: Graphics, tx: number, ty: number): void {
  px(g, tx, ty, 3, 3, 10, 9, TRIM);
  px(g, tx, ty, 4, 4, 8, 7, GLASS);
  px(g, tx, ty, 7, 4, 2, 7, TRIM); // mullion
  px(g, tx, ty, 2, 12, 12, 1, TRIM); // sill
}

function drawHouseDoor(g: Graphics, tx: number, ty: number, side: 'left' | 'right'): void {
  drawSiding(g, tx, ty);
  // Two tiles make one door: frame on the outer edges, knob on the right leaf.
  const x0 = side === 'left' ? 3 : 0;
  const x1 = side === 'left' ? 16 : 13;
  px(g, tx, ty, x0, 1, x1 - x0, 15, TRIM);
  const inner0 = side === 'left' ? 4 : 0;
  const inner1 = side === 'left' ? 16 : 12;
  px(g, tx, ty, inner0, 2, inner1 - inner0, 14, DOOR);
  px(g, tx, ty, inner0, 2, inner1 - inner0, 1, DOOR_DARK);
  px(g, tx, ty, side === 'left' ? 6 : 2, 5, 7, 4, DOOR_DARK); // panel
  px(g, tx, ty, side === 'left' ? 6 : 2, 11, 7, 3, DOOR_DARK);
  if (side === 'right') px(g, tx, ty, 9, 9, 2, 2, BRASS);
}

function buildHouse(): Graphics[] {
  const { house, door } = TOWN_NEIGHBORHOOD_LAYOUT;
  const roofRows = house.h - 2;
  const out: Graphics[] = [];
  for (let row = 0; row < house.h; row++) {
    const ty = house.y + row;
    const g = rowPiece(ty);
    for (let col = 0; col < house.w; col++) {
      const tx = house.x + col;
      if (row < roofRows) {
        drawRoof(g, tx, ty, row, roofRows);
        // Chimney on the right slope.
        if (row === 0 && col === house.w - 2) {
          px(g, tx, ty, 4, 0, 7, 10, CHIMNEY);
          px(g, tx, ty, 3, 0, 9, 2, STONE_LIGHT);
        }
      } else if (ty === door.y && tx >= door.x && tx < door.x + door.w) {
        drawHouseDoor(g, tx, ty, tx === door.x ? 'left' : 'right');
      } else {
        drawSiding(g, tx, ty);
        if (row === roofRows && (col === 1 || col === house.w - 2)) drawHouseWindow(g, tx, ty);
      }
    }
    // Corner trim.
    px(g, house.x, ty, 0, 0, 1, 16, row < roofRows ? ROOF_DARK : TRIM);
    px(g, house.x + house.w - 1, ty, 15, 0, 1, 16, row < roofRows ? ROOF_DARK : TRIM);
    out.push(g);
  }
  return out;
}

// ── Home interior ───────────────────────────────────────────────────────

function drawPlanks(g: Graphics, tx: number, ty: number): void {
  px(g, tx, ty, 0, 0, 16, 16, PLANK);
  for (let row = 0; row < 4; row++) {
    const y = row * 4;
    px(g, tx, ty, 0, y + 3, 16, 1, PLANK_SEAM);
    px(g, tx, ty, 0, y, 16, 1, PLANK_LIGHT);
    // Board ends staggered per row and per tile so it doesn't read as a grid.
    const seam = (row * 5 + tx * 7 + ty * 3) % 16;
    px(g, tx, ty, seam, y, 1, 3, PLANK_SEAM);
  }
}

/** Back wall face, two tiles tall: wallpaper above, wainscot below. */
function drawBackWall(g: Graphics, tx: number): void {
  px(g, tx, 0, 0, 0, 16, 16, WALLPAPER);
  px(g, tx, 1, 0, 0, 16, 6, WALLPAPER);
  for (let x = 2; x < 16; x += 6) {
    px(g, tx, 0, x, 0, 2, 16, WALLPAPER_STRIPE);
    px(g, tx, 1, x, 0, 2, 6, WALLPAPER_STRIPE);
  }
  px(g, tx, 0, 0, 0, 16, 2, WALL_CAP);
  px(g, tx, 1, 0, 6, 16, 10, WAINSCOT);
  px(g, tx, 1, 0, 6, 16, 1, WAINSCOT_LIGHT);
  px(g, tx, 1, 0, 15, 16, 1, WALL_CAP);
}

/** A night window across two back-wall tiles, moon in the left pane. */
function drawNightWindow(g: Graphics, tx: number): void {
  for (const [i, t] of [tx, tx + 1].entries()) {
    const x0 = i === 0 ? 4 : 0;
    const x1 = i === 0 ? 16 : 12;
    px(g, t, 0, x0, 4, x1 - x0, 12, WOOD);
    px(g, t, 1, x0, 0, x1 - x0, 4, WOOD);
    px(g, t, 0, x0 + (i === 0 ? 1 : 0), 5, x1 - x0 - 1, 11, NIGHT);
    px(g, t, 1, x0 + (i === 0 ? 1 : 0), 0, x1 - x0 - 1, 3, NIGHT_DEEP);
  }
  px(g, tx + 1, 0, 0, 4, 1, 12, WOOD); // mullion
  px(g, tx + 1, 1, 0, 0, 1, 4, WOOD);
  px(g, tx, 0, 8, 7, 4, 4, MOON);
  px(g, tx, 0, 10, 7, 2, 2, NIGHT); // crescent bite
  for (const [t, x, y] of [
    [tx, 6, 13],
    [tx + 1, 4, 7],
    [tx + 1, 8, 11],
  ] as const) {
    px(g, t, 0, x, y, 1, 1, MOON);
  }
}

/** Framed picture on the back wall. */
function drawPicture(g: Graphics, tx: number): void {
  px(g, tx, 0, 4, 5, 8, 7, WOOD);
  px(g, tx, 0, 5, 6, 6, 5, 0x9cc3d5);
  px(g, tx, 0, 5, 9, 6, 2, LEAF);
  px(g, tx, 0, 8, 7, 2, 2, LAMP_SHADE);
}

/** Top-down wall cap for the side and front walls. */
function drawWallCap(g: Graphics, tx: number, ty: number): void {
  px(g, tx, ty, 0, 0, 16, 16, WALL_CAP);
  px(g, tx, ty, 0, 0, 16, 2, WALL_CAP_EDGE);
}

function drawDoorFrame(g: Graphics, tx: number, ty: number, side: 'left' | 'right'): void {
  drawWallCap(g, tx, ty);
  px(g, tx, ty, side === 'left' ? 13 : 0, 0, 3, 16, WOOD);
  px(g, tx, ty, side === 'left' ? 13 : 2, 0, 1, 16, WOOD_DARK);
}

/**
 * One placed piece, drawn at its tiles. Solid pieces depth-sort at their
 * bottom row; walk-over ones (rugs, flower beds) lie on the ground. Pines are
 * sprites, drawn by the engine: null here.
 */
export function drawPlacement(p: TownPlacement): Graphics | null {
  const def = townBuiltin(p.builtin);
  const fp = townFootprint(p);
  if (!def || !fp || p.builtin === 'pine') return null;
  // Drawn unturned at the origin, then turned and moved onto its tiles.
  const f = { x: 0, y: 0, w: def.w, h: def.h };
  const g = def.solid ? rowPiece(p.y + fp.h - 1) : groundPiece(-4400);
  const { x, y } = f;
  switch (p.builtin) {
    case 'bed': {
      // Headboard at the wall, pillow, then the quilt.
      for (let i = 0; i < f.w; i++) {
        const l = i === 0 ? 1 : 0;
        const r = i === f.w - 1 ? 15 : 16;
        px(g, x + i, y, l, 0, r - l, 4, WOOD);
        px(g, x + i, y, l, 4, r - l, 12, LINEN);
        px(g, x + i, y, l + 1, 5, r - l - 2, 5, 0xfaf4ea);
        for (let row = 1; row < f.h; row++) {
          px(g, x + i, y + row, l, 0, r - l, 16, QUILT);
          px(g, x + i, y + row, l, 0, r - l, 2, LINEN);
          for (let yy = 5; yy < 16; yy += 6) px(g, x + i, y + row, l, yy, r - l, 1, QUILT_SHADE);
        }
        px(g, x + i, y + f.h - 1, l, 14, r - l, 2, WOOD);
      }
      break;
    }
    case 'nightstand': {
      px(g, x, y, 2, 6, 12, 10, WOOD);
      px(g, x, y, 2, 6, 12, 1, MAT_STRIPE);
      px(g, x, y, 6, 11, 4, 1, BRASS);
      px(g, x, y, 7, 3, 2, 4, WOOD_DARK); // lamp stem
      px(g, x, y, 4, 0, 8, 4, LAMP_SHADE);
      break;
    }
    case 'couch': {
      for (let i = 0; i < f.w; i++) {
        const l = i === 0 ? 1 : 0;
        const r = i === f.w - 1 ? 15 : 16;
        px(g, x + i, y, l, 1, r - l, 7, COUCH_SHADE); // back
        px(g, x + i, y, l, 8, r - l, 7, COUCH); // seat
        px(g, x + i, y, l, 14, r - l, 1, COUCH_SHADE);
        if (i < f.w - 1) px(g, x + i, y, 15, 8, 1, 6, COUCH_SHADE); // cushion seam
      }
      px(g, x, y, 0, 3, 3, 12, COUCH_SHADE); // arms
      px(g, x + f.w - 1, y, 13, 3, 3, 12, COUCH_SHADE);
      px(g, x + 1, y, 5, 6, 6, 4, LAMP_SHADE); // a cushion
      break;
    }
    case 'bookshelf': {
      for (let row = 0; row < f.h; row++) {
        px(g, x, y + row, 1, 0, 14, 16, WOOD);
        for (let shelf = 0; shelf < 2; shelf++) {
          const sy = shelf * 8 + 1;
          px(g, x, y + row, 2, sy, 12, 6, WOOD_DARK);
          for (let b = 0; b < 4; b++) {
            const color = BOOKS[(row * 2 + shelf + b) % BOOKS.length] ?? WOOD;
            px(g, x, y + row, 2 + b * 3, sy + 1 + (b % 2), 2, 5 - (b % 2), color);
          }
        }
      }
      break;
    }
    case 'plant': {
      px(g, x, y, 5, 10, 6, 6, POT);
      px(g, x, y, 4, 10, 8, 1, 0xc97a50);
      px(g, x, y, 3, 2, 10, 8, LEAF);
      px(g, x, y, 6, 0, 4, 4, LEAF);
      px(g, x, y, 4, 5, 3, 3, LEAF_DARK);
      px(g, x, y, 9, 3, 3, 3, LEAF_DARK);
      break;
    }
    case 'armchair': {
      px(g, x, y, 2, 1, 12, 7, ARMCHAIR_SHADE); // back
      px(g, x, y, 2, 8, 12, 7, ARMCHAIR); // seat
      px(g, x, y, 1, 4, 3, 11, ARMCHAIR_SHADE); // arms
      px(g, x, y, 12, 4, 3, 11, ARMCHAIR_SHADE);
      px(g, x, y, 4, 14, 8, 1, ARMCHAIR_SHADE);
      break;
    }
    case 'table': {
      for (let i = 0; i < f.w; i++) {
        const l = i === 0 ? 1 : 0;
        const r = i === f.w - 1 ? 15 : 16;
        px(g, x + i, y, l, 3, r - l, 8, WOOD);
        px(g, x + i, y, l, 3, r - l, 1, MAT_STRIPE);
        px(g, x + i, y, l, 11, r - l, 1, WOOD_DARK);
      }
      px(g, x, y, 2, 12, 2, 4, WOOD_DARK); // legs
      px(g, x + f.w - 1, y, 12, 12, 2, 4, WOOD_DARK);
      px(g, x + f.w - 1, y, 0, 5, 3, 3, LAMP_SHADE); // a cup, where the halves meet
      break;
    }
    case 'bench':
      drawBench(g, f);
      break;
    case 'bush': {
      px(g, x, y, 2, 5, 12, 10, LEAF_DARK);
      px(g, x, y, 1, 7, 14, 6, LEAF_DARK);
      px(g, x, y, 3, 4, 10, 8, LEAF);
      px(g, x, y, 5, 2, 6, 4, LEAF);
      px(g, x, y, 5, 5, 2, 2, 0x7cb866); // highlights
      px(g, x, y, 9, 8, 2, 2, 0x7cb866);
      break;
    }
    case 'flowerbed': {
      for (let i = 0; i < f.w; i++) {
        px(g, x + i, y, 0, 3, 16, 12, DIRT);
        px(g, x + i, y, 0, 3, 16, 1, DIRT_DARK);
        for (let b = 0; b < 3; b++) {
          const bx = 2 + b * 5;
          const by = 5 + ((b + i) % 2) * 4;
          px(g, x + i, y, bx + 1, by + 2, 1, 3, LEAF_DARK);
          px(g, x + i, y, bx, by, 3, 3, BLOOMS[(b + i * 3) % BLOOMS.length] ?? LINEN);
        }
      }
      break;
    }
    case 'lamppost': {
      // A tall post: the lantern stands well above its tile.
      px(g, x, y, 5, 13, 6, 3, IRON); // foot
      px(g, x, y, 7, -12, 2, 25, IRON);
      px(g, x, y, 4, -18, 8, 7, IRON);
      px(g, x, y, 5, -17, 6, 5, LAMP_SHADE);
      px(g, x, y, 6, -20, 4, 2, IRON_LIGHT);
      break;
    }
    case 'rug': {
      for (let i = 0; i < f.w; i++) {
        for (let j = 0; j < f.h; j++) {
          px(g, x + i, y + j, 0, 0, 16, 16, RUG);
          if (j === 0) px(g, x + i, y + j, 0, 1, 16, 2, RUG_BORDER);
          if (j === f.h - 1) px(g, x + i, y + j, 0, 13, 16, 2, RUG_BORDER);
          if (i === 0) px(g, x + i, y + j, 1, 0, 2, 16, RUG_BORDER);
          if (i === f.w - 1) px(g, x + i, y + j, 13, 0, 2, 16, RUG_BORDER);
          if ((i + j) % 2 === 0) px(g, x + i, y + j, 7, 7, 2, 2, RUG_BORDER);
        }
      }
      break;
    }
  }
  const turns = townRotation(p);
  g.rotation = (turns * Math.PI) / 2;
  // Turning about the origin swings the drawing out of its box; shift it back.
  const W = def.w * TOWN_TILE;
  const Hh = def.h * TOWN_TILE;
  const shift = [
    [0, 0],
    [Hh, 0],
    [W, Hh],
    [0, W],
  ][turns] ?? [0, 0];
  g.position.set(p.x * TOWN_TILE + (shift[0] ?? 0), p.y * TOWN_TILE + (shift[1] ?? 0));
  return g;
}

function buildHome(): Container[] {
  const H = TOWN_HOME_LAYOUT;
  const out: Container[] = [];

  const floor = groundPiece(-10000);
  for (let tx = 1; tx < H.w - 1; tx++) {
    for (let ty = 2; ty < H.h - 1; ty++) drawPlanks(floor, tx, ty);
  }
  for (let tx = H.door.x; tx < H.door.x + H.door.w; tx++) {
    drawPlanks(floor, tx, H.door.y);
    drawMat(floor, tx, H.door.y - 1);
  }
  out.push(floor);

  // Back wall + window + picture: one piece, depth at the wall's base row.
  const back = rowPiece(1);
  for (let tx = 0; tx < H.w; tx++) drawBackWall(back, tx);
  drawNightWindow(back, 8);
  drawPicture(back, 4);
  out.push(back);

  for (let ty = 2; ty < H.h; ty++) {
    const g = rowPiece(ty);
    for (let tx = 0; tx < H.w; tx++) {
      if (barrierAt('home', tx, ty) !== 'wall') continue;
      if (ty === H.door.y && tx === H.door.x - 1) drawDoorFrame(g, tx, ty, 'left');
      else if (ty === H.door.y && tx === H.door.x + H.door.w) drawDoorFrame(g, tx, ty, 'right');
      else drawWallCap(g, tx, ty);
    }
    out.push(g);
  }

  return out;
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
    const lx = lamp.x * TOWN_TILE + TOWN_TILE / 2;
    const ly = lamp.y * TOWN_TILE + TOWN_TILE / 3;
    for (let r = 160; r > 20; r -= 14) {
      glow.circle(lx, ly, r).fill({ color: LAMP_GLOW, alpha: 0.022 });
    }
  }
  glow.zIndex = 100_000; // over everything, it's light
  glow.eventMode = 'none';
  return glow;
}

function buildNeighborhood(): Container[] {
  const N = TOWN_NEIGHBORHOOD_LAYOUT;
  const ground = groundPiece();
  for (let ty = N.door.y + 2; ty <= N.gate.y; ty++) {
    for (let tx = N.gate.x; tx < N.gate.x + N.gate.w; tx++) drawPath(ground, tx, ty);
  }
  for (let tx = N.door.x; tx < N.door.x + N.door.w; tx++) drawMat(ground, tx, N.door.y + 1);
  const f = N.fence;
  return [
    ground,
    ...buildHouse(),
    ...buildFence(
      'neighborhood',
      N.w,
      N.h,
      [N.gate],
      (tx, ty) => (tx === f.x || tx === f.x + f.w - 1) && ty !== f.y && ty !== f.y + f.h - 1,
    ),
  ];
}

function drawFlagstones(g: Graphics, tx: number, ty: number): void {
  px(g, tx, ty, 0, 0, 16, 16, FLAG);
  // Two rows of offset slabs per tile.
  px(g, tx, ty, 0, 7, 16, 1, FLAG_JOINT);
  px(g, tx, ty, 0, 15, 16, 1, FLAG_JOINT);
  const off = (tx + ty) % 2 === 0 ? 5 : 11;
  px(g, tx, ty, off, 0, 1, 7, FLAG_JOINT);
  px(g, tx, ty, (off + 8) % 16, 8, 1, 7, FLAG_JOINT);
  px(g, tx, ty, 1, 1, 3, 1, FLAG_LIGHT);
  px(g, tx, ty, 9, 9, 3, 1, FLAG_LIGHT);
}

/** Round stone basin with a spouting column, drawn row by row on the pixel grid. */
function drawFountain(g: Graphics, r: { x: number; y: number; w: number; h: number }): void {
  const size = r.w * 16; // pixel-grid units across
  const c = size / 2;
  const ox = r.x * TOWN_TILE;
  const oy = r.y * TOWN_TILE;
  const span = (rad: number, y: number) => Math.sqrt(Math.max(0, rad * rad - (y - c + 0.5) ** 2));
  for (let y = 0; y < size; y++) {
    const outer = span(c - 1, y);
    if (outer <= 0) continue;
    const row = (x0: number, x1: number, color: number) => {
      g.rect(
        ox + Math.round(x0) * U,
        oy + y * U,
        Math.max(0, Math.round(x1) - Math.round(x0)) * U,
        U,
      ).fill(color);
    };
    row(c - outer, c + outer, STONE);
    const water = span(c - 6, y);
    if (water > 0)
      row(c - water, c + water, (y + Math.round(water)) % 7 === 0 ? WATER_LIGHT : WATER);
    const column = span(5, y);
    if (column > 0) row(c - column, c + column, STONE_LIGHT);
  }
  // Spray from the column top.
  for (const [dx, dy] of [
    [-1, -3],
    [0, -5],
    [1, -3],
    [-3, 0],
    [3, 0],
    [0, -1],
  ] as const) {
    g.rect(ox + (c + dx) * U, oy + (c + dy) * U, U, U).fill(WATER_LIGHT);
  }
}

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

/** An empty lot waiting for a building: dirt patch, string-and-stake outline. */
function drawLot(g: Graphics, r: { x: number; y: number; w: number; h: number }): void {
  for (let tx = r.x; tx < r.x + r.w; tx++) {
    for (let ty = r.y; ty < r.y + r.h; ty++) {
      px(g, tx, ty, 0, 0, 16, 16, DIRT);
      if ((tx * 3 + ty * 5) % 4 === 0) px(g, tx, ty, 5, 9, 3, 2, DIRT_DARK);
      const edge = tx === r.x || tx === r.x + r.w - 1 || ty === r.y || ty === r.y + r.h - 1;
      if (edge && (tx + ty) % 2 === 0) px(g, tx, ty, 7, 7, 2, 2, STAKE);
    }
  }
}

function drawSignpost(g: Graphics, tx: number, ty: number): void {
  px(g, tx, ty, 7, 4, 2, 12, WOOD_DARK);
  px(g, tx, ty, 2, 2, 12, 4, WOOD);
  px(g, tx, ty, 12, 3, 2, 2, WOOD); // arrow tip
  px(g, tx, ty, 3, 7, 10, 3, WOOD);
  px(g, tx, ty, 2, 8, 2, 1, WOOD);
}

function buildSquare(openSlots: ReadonlySet<number>, hasSignpost: boolean): Container[] {
  const S = TOWN_SQUARE_LAYOUT;
  const ground = groundPiece();
  for (let tx = S.plaza.x; tx < S.plaza.x + S.plaza.w; tx++) {
    for (let ty = S.plaza.y; ty < S.plaza.y + S.plaza.h; ty++) drawFlagstones(ground, tx, ty);
  }
  // A walk along the gate row, and one down to the plaza.
  const first = Math.min(...S.gateSlots);
  const last = Math.max(...S.gateSlots) + 1;
  for (let tx = first; tx <= last; tx++) {
    for (let ty = S.fenceY + 1; ty <= S.fenceY + 2; ty++) drawPath(ground, tx, ty);
  }
  for (let ty = S.fenceY + 3; ty < S.plaza.y; ty++) {
    for (let tx = 19; tx <= 20; tx++) drawPath(ground, tx, ty);
  }
  for (const lot of [S.lots.arcade, S.lots.theater]) drawLot(ground, lot);

  const fountain = rowPiece(S.fountain.y + S.fountain.h - 1);
  drawFountain(fountain, S.fountain);
  const benches = S.benches.map((b) => {
    const g = rowPiece(b.y);
    drawBench(g, b);
    return g;
  });
  // The signpost only stands when it has neighborhoods to list.
  const signpost = rowPiece(S.signpost.y);
  if (hasSignpost) drawSignpost(signpost, S.signpost.x, S.signpost.y);

  const open = S.gateSlots
    .map((x, slot) => ({ x, y: S.fenceY, w: 2, slot }))
    .filter((g) => openSlots.has(g.slot));
  return [
    ground,
    fountain,
    ...benches,
    signpost,
    ...buildFence(
      'square',
      S.w,
      S.h,
      open,
      () => false,
      (tx, ty) => {
        const slot = gateSlotAt(tx, ty);
        return slot !== null && !openSlots.has(slot);
      },
    ),
  ];
}

/**
 * Build a scene's structures. Each barrier row is its own Graphics with zIndex
 * at its base, so avatars depth-sort correctly in front of / behind them.
 */
export function buildStructures(
  kind: TownSceneKind,
  openSlots: ReadonlySet<number> = new Set(),
  hasSignpost = false,
): Container[] {
  if (kind === 'home') return buildHome();
  if (kind === 'neighborhood') return buildNeighborhood();
  return buildSquare(openSlots, hasSignpost);
}

/**
 * Warm light in the house's front windows (and a soft spill on the siding
 * and grass below) — shown while the owner is home and visible to you.
 */
export function buildWindowGlow(): Container {
  const { house } = TOWN_NEIGHBORHOOD_LAYOUT;
  const ty = house.y + house.h - 2; // the window row
  const g = new Graphics();
  for (const col of [1, house.w - 2]) {
    const tx = house.x + col;
    px(g, tx, ty, 4, 4, 3, 7, WINDOW_LIT);
    px(g, tx, ty, 9, 4, 3, 7, WINDOW_LIT);
    px(g, tx, ty, 4, 4, 3, 2, WINDOW_LIT_HOT);
    px(g, tx, ty, 9, 4, 3, 2, WINDOW_LIT_HOT);
    const cx = tx * TOWN_TILE + TOWN_TILE / 2;
    const cy = ty * TOWN_TILE + TOWN_TILE / 2;
    for (let r = 44; r > 8; r -= 9) {
      g.circle(cx, cy, r).fill({ color: LAMP_GLOW, alpha: 0.05 });
    }
  }
  // Just above the house's front row, so it sits over the glass.
  g.zIndex = (ty + 1) * TOWN_TILE;
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

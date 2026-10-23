import { Container, Graphics } from 'pixi.js';
import {
  TOWN_DOOR,
  TOWN_GATE,
  TOWN_HOME_RECT,
  TOWN_MAP_H,
  TOWN_MAP_W,
  TOWN_NEIGHBORHOOD_RECT,
  TOWN_TILE,
  townBarrierAtTile,
} from '@protoimsg/shared';

// Procedural pixel art for the home walls and neighborhood fence, drawn on a
// 16-px grid scaled 3× so it matches the CC0 town pack (48-px tiles).
const U = TOWN_TILE / 16;

const STONE = 0x7d7468;
const STONE_LIGHT = 0xa59a8a;
const MORTAR = 0x5b5349;
const PICKET = 0xf1ebdf;
const PICKET_SHADE = 0xb9b09f;
const WOOD = 0x6b4426;
const WOOD_DARK = 0x4a2e19;
const MAT = 0x8a5a33;
const MAT_STRIPE = 0xb07a47;
const PATH = 0xcbb894;
const PATH_EDGE = 0xa8956f;

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

function drawWall(g: Graphics, tx: number, ty: number): void {
  px(g, tx, ty, 0, 0, 16, 16, STONE);
  // Staggered brick courses.
  for (let row = 0; row < 4; row++) {
    const y = row * 4;
    px(g, tx, ty, 0, y + 3, 16, 1, MORTAR);
    const offset = row % 2 === 0 ? 0 : 4;
    for (let x = offset; x < 16; x += 8) px(g, tx, ty, x, y, 1, 3, MORTAR);
  }
  // Lit top edge reads as wall height in a top-down view.
  px(g, tx, ty, 0, 0, 16, 2, STONE_LIGHT);
}

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

function drawDoorPost(g: Graphics, tx: number, ty: number, side: 'left' | 'right'): void {
  const x = side === 'left' ? 13 : 0;
  px(g, tx, ty, x, 0, 3, 16, WOOD);
  px(g, tx, ty, side === 'left' ? 13 : 2, 0, 1, 16, WOOD_DARK);
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

/**
 * Build the walls, fence, door, gate and the path between them. Each barrier
 * tile is its own Graphics with zIndex at its base, so avatars depth-sort
 * correctly in front of / behind them.
 */
export function buildStructures(): Container[] {
  const out: Container[] = [];

  // Ground details (under everything that walks).
  const ground = new Graphics();
  for (let ty = TOWN_DOOR.y + 1; ty <= TOWN_GATE.y; ty++) {
    for (let tx = TOWN_GATE.from; tx <= TOWN_GATE.to; tx++) drawPath(ground, tx, ty);
  }
  for (let tx = TOWN_DOOR.from; tx <= TOWN_DOOR.to; tx++) drawMat(ground, tx, TOWN_DOOR.y);
  ground.zIndex = -4500;
  out.push(ground);

  for (let tx = 0; tx < TOWN_MAP_W; tx++) {
    for (let ty = 0; ty < TOWN_MAP_H; ty++) {
      const barrier = townBarrierAtTile(tx, ty);
      if (!barrier) continue;
      const g = new Graphics();
      if (barrier === 'wall') {
        drawWall(g, tx, ty);
        if (ty === TOWN_DOOR.y && tx === TOWN_DOOR.from - 1) drawDoorPost(g, tx, ty, 'left');
        if (ty === TOWN_DOOR.y && tx === TOWN_DOOR.to + 1) drawDoorPost(g, tx, ty, 'right');
      } else {
        const r = TOWN_NEIGHBORHOOD_RECT;
        const vertical = (tx === r.x || tx === r.x + r.w - 1) && ty !== r.y && ty !== r.y + r.h - 1;
        drawFence(g, tx, ty, vertical);
        if (ty === TOWN_GATE.y && tx === TOWN_GATE.from - 1) drawGatePost(g, tx, ty, 'left');
        if (ty === TOWN_GATE.y && tx === TOWN_GATE.to + 1) drawGatePost(g, tx, ty, 'right');
      }
      g.zIndex = (ty + 1) * TOWN_TILE - 1;
      out.push(g);
    }
  }
  return out;
}

/** World-px anchor for each area's floating label (just inside its top edge). */
export const AREA_LABEL_POS = {
  home: {
    x: (TOWN_HOME_RECT.x + TOWN_HOME_RECT.w / 2) * TOWN_TILE,
    y: (TOWN_HOME_RECT.y + 1) * TOWN_TILE + 8,
  },
  neighborhood: {
    x: (TOWN_NEIGHBORHOOD_RECT.x + TOWN_NEIGHBORHOOD_RECT.w / 2) * TOWN_TILE,
    y: (TOWN_NEIGHBORHOOD_RECT.y + 1) * TOWN_TILE + 8,
  },
} as const;

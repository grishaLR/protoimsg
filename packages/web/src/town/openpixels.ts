import { Rectangle, Sprite, Texture, TilingSprite } from 'pixi.js';
import { TOWN_TILE } from '@protoimsg/shared';

// The OpenPixels tileset by Silveira Neto (CC BY-SA 4.0), drawn from one
// unmodified sheet: every frame below is a rectangle of it, cut at runtime.
// Its art is 32 px a tile, the size of ours, so it draws at 1× (2 screen
// pixels per art pixel under the camera's 2×, like the avatars beside it).

export const OPENPIXELS_SHEET = '/assets/town/openpixels/open_tileset.png';

const ART_TILE = 32;
export const ART_SCALE = TOWN_TILE / ART_TILE;

type Frame = readonly [x: number, y: number, w: number, h: number];

/** One art tile at (column, row) of the sheet. */
const at = (col: number, row: number, w = 1, h = 1): Frame => [
  col * ART_TILE,
  row * ART_TILE,
  w * ART_TILE,
  h * ART_TILE,
];

export const FRAMES = {
  // Ground
  grass: at(5, 17),
  sand: at(5, 15),
  pavement: at(14, 16),
  floor: at(6, 0),
  mat: at(9, 5),
  // Walls indoors: a run's left end, middle (two variants), right end; and
  // the wallpaper below the back wall's run.
  wallL: at(1, 1),
  wallM1: at(2, 1),
  wallM2: at(3, 1),
  wallR: at(4, 1),
  paperL: at(1, 2),
  paperM: at(2, 2),
  paperR: at(3, 2),
  // House (the sheet's cottage, widened): roof rows, then an upper wall
  // with the windows and a lower one with the door. Column 0 is its left end,
  // columns 1–2 repeat across the front, column 3 is its right end (chimney).
  houseL0: at(0, 29),
  houseL1: at(0, 30),
  houseL2: at(0, 31),
  houseL3: at(0, 32),
  roofA0: at(1, 29),
  roofA1: at(1, 30),
  roofB0: at(2, 29),
  roofB1: at(2, 30),
  houseR0: at(3, 29),
  houseR1: at(3, 30),
  houseR2: at(3, 31),
  houseR3: at(8, 32),
  wallUpper: at(4, 31),
  wallLower: at(7, 32),
  doorTop: at(1, 31),
  door: at(1, 32),
  window: at(7, 31, 2, 1),
  // Fence: one repeat of a horizontal run, and of a vertical one.
  fenceH: [782, 250, 32, 22],
  fenceV: [780, 288, 12, 32],
  // Outdoors
  tree: [0, 583, 64, 57],
  well: [960, 294, 64, 58],
  sign: [227, 581, 25, 24],
  // Placeable pieces
  bed: [416, 102, 64, 58],
  nightstand: [192, 109, 32, 51],
  couch: [416, 192, 64, 32],
  armchair: [486, 262, 20, 20],
  table: [192, 417, 63, 60],
  bookshelf: [224, 98, 64, 62],
  plant: [227, 176, 27, 42],
  rug: [196, 288, 120, 96],
  bush: [77, 590, 40, 40],
  flower1: at(6, 18),
  flower2: at(6, 19),
  garden: [512, 512, 64, 64],
  boulder: at(4, 18),
  stone: at(4, 19),
  chest: [416, 288, 32, 32],
  barrel: [193, 384, 30, 32],
  wildflowers: [612, 644, 40, 44],
} as const satisfies Record<string, Frame>;

export type FrameId = keyof typeof FRAMES;

/** Frames for each placeable piece drawn from the sheet (several = side by side). */
export const PIECE_FRAMES: Partial<Record<string, readonly FrameId[]>> = {
  bed: ['bed'],
  nightstand: ['nightstand'],
  couch: ['couch'],
  armchair: ['armchair'],
  table: ['table'],
  bookshelf: ['bookshelf'],
  plant: ['plant'],
  rug: ['rug'],
  pine: ['tree'],
  bush: ['bush'],
  flowerbed: ['flower1', 'flower2'],
  garden: ['garden'],
  boulder: ['boulder'],
  stone: ['stone'],
  chest: ['chest'],
  barrel: ['barrel'],
  wildflowers: ['wildflowers'],
};

/** The loaded sheet: frames as textures, made once and shared. */
export class OpenPixels {
  private frames = new Map<FrameId, Texture>();
  private repeats = new Map<FrameId, Texture>();

  constructor(
    private base: Texture,
    private image: HTMLImageElement,
  ) {}

  frame(id: FrameId): Texture {
    let tex = this.frames.get(id);
    if (!tex) {
      const [x, y, w, h] = FRAMES[id];
      tex = new Texture({ source: this.base.source, frame: new Rectangle(x, y, w, h) });
      this.frames.set(id, tex);
    }
    return tex;
  }

  /** A frame scaled to the world, its top-left at (x, y) in world px. */
  sprite(id: FrameId, x: number, y: number, flip = false): Sprite {
    const s = new Sprite(this.frame(id));
    s.scale.set(flip ? -ART_SCALE : ART_SCALE, ART_SCALE);
    s.position.set(flip ? x + s.width : x, y);
    return s;
  }

  /**
   * A frame repeated over a rectangle of tiles (ground). Repeating needs a
   * texture of its own, not a window onto the sheet.
   */
  tiled(id: FrameId, tx: number, ty: number, tw: number, th: number): TilingSprite {
    let tex = this.repeats.get(id);
    if (!tex) {
      const [x, y, w, h] = FRAMES[id];
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')?.drawImage(this.image, x, y, w, h, 0, 0, w, h);
      tex = Texture.from(canvas);
      tex.source.scaleMode = 'nearest';
      this.repeats.set(id, tex);
    }
    const t = new TilingSprite({ texture: tex, width: tw * TOWN_TILE, height: th * TOWN_TILE });
    t.tileScale.set(ART_SCALE);
    t.position.set(tx * TOWN_TILE, ty * TOWN_TILE);
    return t;
  }

  destroy(): void {
    for (const t of this.frames.values()) t.destroy();
    for (const t of this.repeats.values()) t.destroy(true);
    this.frames.clear();
    this.repeats.clear();
  }
}

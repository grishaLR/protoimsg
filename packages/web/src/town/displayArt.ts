import { Texture } from 'pixi.js';
import type { ItemPicture } from './wardrobeItems';

// Art for items shown on a wardrobe. rpg.actor gives carry either an icon or
// the worn layer's 3×4 walk sheet; for a sheet we take the front-facing
// standing frame. Either way the art is trimmed to what's actually drawn, so
// a hat isn't a speck at the top of an empty character-sized frame.

/** Anything bigger isn't item art: don't decode it. */
const MAX_SIDE = 1024;
const SHEET_COLS = 3;
const SHEET_ROWS = 4;

function loadImage(src: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const abort = (): void => {
      img.src = '';
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', abort, { once: true });
    img.onload = () => {
      signal.removeEventListener('abort', abort);
      resolve(img);
    };
    img.onerror = () => {
      signal.removeEventListener('abort', abort);
      reject(new Error('item art failed to load'));
    };
    img.src = src;
  });
}

/** `img`'s region as pixels (null: unreadable). */
function pixels(img: HTMLImageElement, sx: number, sy: number, sw: number, sh: number) {
  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  try {
    return ctx.getImageData(0, 0, sw, sh);
  } catch {
    return null; // tainted after all (crossOrigin should have refused the load)
  }
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Which colour a mask pixel asks for: blue 1st, green 2nd, red 3rd (-1: none). */
function maskChannel(r: number, g: number, b: number, a: number): number {
  if (a === 0) return -1;
  if (b > 127 && r < 128 && g < 128) return 0;
  if (g > 127 && r < 128 && b < 128) return 1;
  if (r > 127 && g < 128 && b < 128) return 2;
  return -1;
}

/**
 * Colour a grey worn layer the way it's worn: each masked pixel takes its
 * channel's colour, shaded by its grey (mid-grey, 128, is the colour itself).
 */
function tint(art: ImageData, mask: ImageData, colors: readonly string[]): void {
  const rgb = colors.map(hexRgb);
  const a = art.data;
  const m = mask.data;
  for (let i = 0; i < a.length; i += 4) {
    if ((a[i + 3] ?? 0) === 0) continue;
    const ch = maskChannel(m[i] ?? 0, m[i + 1] ?? 0, m[i + 2] ?? 0, m[i + 3] ?? 0);
    const c = rgb[ch];
    if (!c) continue;
    const k = ((a[i] ?? 0) + (a[i + 1] ?? 0) + (a[i + 2] ?? 0)) / 3 / 128;
    a[i] = Math.min(255, Math.round(c[0] * k));
    a[i + 1] = Math.min(255, Math.round(c[1] * k));
    a[i + 2] = Math.min(255, Math.round(c[2] * k));
  }
}

/** The drawn part of an image (null: nothing drawn). */
function trim(image: ImageData): HTMLCanvasElement | null {
  const { width: sw, height: sh, data } = image;
  let minX = sw;
  let minY = sh;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if ((data[(y * sw + x) * 4 + 3] ?? 0) === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  const octx = out.getContext('2d');
  if (!octx) return null;
  octx.putImageData(image, -minX, -minY);
  return out;
}

/**
 * An item's art, cut out and trimmed: the icon, or a worn sheet's
 * front-facing standing frame, in colour when it comes with a mask. Null
 * when there's nothing to show. Shared by the wardrobe in town and the
 * previews in its picker.
 */
export async function loadItemArt(
  item: ItemPicture,
  signal: AbortSignal,
): Promise<HTMLCanvasElement | null> {
  try {
    const [img, maskImg] = await Promise.all([
      loadImage(item.image, signal),
      // A mask that won't load: show it uncoloured rather than not at all.
      item.mask && item.colors?.length
        ? loadImage(item.mask, signal).catch(() => null)
        : Promise.resolve(null),
    ]);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h || w > MAX_SIDE || h > MAX_SIDE) return null;
    // Front-facing standing frame: first row, first column.
    const fw = item.sheet ? Math.floor(w / SHEET_COLS) : w;
    const fh = item.sheet ? Math.floor(h / SHEET_ROWS) : h;
    const art = pixels(img, 0, 0, fw, fh);
    if (!art) return null;
    if (maskImg && maskImg.naturalWidth === w && maskImg.naturalHeight === h && item.colors) {
      const mask = pixels(maskImg, 0, 0, fw, fh);
      if (mask) tint(art, mask, item.colors);
    }
    const canvas = trim(art);
    return canvas && !signal.aborted ? canvas : null;
  } catch {
    return null;
  }
}

/** An item's art as a crisp texture, or null when there's nothing to show. */
export async function loadDisplayArt(
  item: ItemPicture,
  signal: AbortSignal,
): Promise<Texture | null> {
  const canvas = await loadItemArt(item, signal);
  if (!canvas) return null;
  const tex = Texture.from(canvas);
  tex.source.scaleMode = 'nearest';
  return tex;
}

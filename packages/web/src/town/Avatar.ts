import { Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';

export const FRAME = 48; // rpg.actor sprite sheet cell size
const COLS = 3; // walk-cycle columns
const WALK_CYCLE = [1, 0, 2, 0] as const;
const WALK_FRAME_MS = 150;
const BUBBLE_MS = 6000;
const NEUTRAL_COL = 0; // idle pose

export const DIR_FORWARD = 0;
export const DIR_LEFT = 1;
export const DIR_RIGHT = 2;
export const DIR_BACK = 3;

/** Slice a 3x4 rpg.actor sheet (one shared base texture) into [dir][frame]. */
export function buildFrames(base: Texture): Texture[][] {
  const frames: Texture[][] = [];
  for (let row = 0; row < 4; row++) {
    const rowFrames: Texture[] = [];
    for (let col = 0; col < COLS; col++) {
      rowFrames.push(
        new Texture({
          source: base.source,
          frame: new Rectangle(col * FRAME, row * FRAME, FRAME, FRAME),
        }),
      );
    }
    frames.push(rowFrames);
  }
  return frames;
}

function makeBubble(text: string): Container {
  const c = new Container();
  const label = new Text({
    text,
    style: {
      fontFamily: 'sans-serif',
      fontSize: 11,
      fill: 0x1a1726,
      align: 'center',
      wordWrap: true,
      wordWrapWidth: 150,
    },
  });
  label.anchor.set(0.5, 0.5);
  const w = Math.ceil(label.width) + 12;
  const h = Math.ceil(label.height) + 8;
  const bg = new Graphics()
    .roundRect(-w / 2, -h, w, h, 5)
    .fill(0xffffff)
    .moveTo(-4, 0)
    .lineTo(4, 0)
    .lineTo(0, 5)
    .fill(0xffffff);
  label.position.set(0, -h / 2);
  c.addChild(bg, label);
  return c;
}

/**
 * A walking character in the town — the local player or a remote peer.
 * Owns a Pixi container holding the sprite, a name label, and an optional
 * transient chat bubble.
 */
export class Avatar {
  readonly container = new Container();
  private sprite = new Sprite();
  private fallbackSprite: Sprite | null = null;
  private label: Text;
  private frames: Texture[][] = [];
  private bubble: Container | null = null;
  private bubbleExpiry = 0;
  private animStep = 0;
  private animMs = 0;
  private moving = false;
  private destroyed = false;
  dir = DIR_FORWARD;

  constructor(name: string) {
    this.sprite.anchor.set(0.5, 1);
    this.container.addChild(this.sprite);
    this.label = new Text({
      text: name,
      style: {
        fontFamily: 'monospace',
        fontSize: 9,
        fill: 0xffffff,
        align: 'center',
        stroke: { color: 0x1a1726, width: 3 },
      },
    });
    this.label.anchor.set(0.5, 0);
    this.label.y = 3;
    this.container.addChild(this.label);
  }

  setName(name: string): void {
    if (this.destroyed) return;
    this.label.text = name;
  }

  setFrames(frames: Texture[][]): void {
    if (this.destroyed) return;
    this.frames = frames;
    // Don't call setSize — the 48×48 frame textures render at native size with
    // the default scale of 1. Calling setSize before applyFrame would compute
    // a huge scale against the empty default texture and the sprite would
    // explode in size.
    this.applyFrame();
    // Real sprite is in — retire the portal placeholder.
    if (this.fallbackSprite) {
      this.container.removeChild(this.fallbackSprite);
      this.fallbackSprite.destroy();
      this.fallbackSprite = null;
    }
  }

  /** Show a procedural spinning portal while the real rpg.actor sprite loads. */
  setFallbackTexture(tex: Texture): void {
    if (this.destroyed || this.frames.length > 0) return;
    if (this.fallbackSprite) {
      this.fallbackSprite.texture = tex;
      return;
    }
    const s = new Sprite(tex);
    s.anchor.set(0.5, 0.5);
    s.position.set(0, -FRAME / 2);
    s.scale.set(2); // 16-px source → 32-px on screen, nearest-neighbor
    this.fallbackSprite = s;
    this.container.addChild(s);
  }

  private applyFrame(): void {
    const row = this.frames[this.dir];
    if (!row) return;
    const col = this.moving ? (WALK_CYCLE[this.animStep] ?? NEUTRAL_COL) : NEUTRAL_COL;
    const tex = row[col];
    if (tex) this.sprite.texture = tex;
  }

  /** Advance walk animation and expire the chat bubble. */
  tick(dtMs: number, moving: boolean): void {
    if (this.destroyed) return;
    if (this.fallbackSprite) this.fallbackSprite.rotation += dtMs * 0.002;
    this.moving = moving;
    if (moving) {
      this.animMs += dtMs;
      if (this.animMs >= WALK_FRAME_MS) {
        this.animMs = 0;
        this.animStep = (this.animStep + 1) % WALK_CYCLE.length;
      }
    } else {
      this.animStep = 0;
      this.animMs = 0;
    }
    this.applyFrame();

    if (this.bubble && performance.now() > this.bubbleExpiry) {
      this.container.removeChild(this.bubble);
      this.bubble.destroy({ children: true });
      this.bubble = null;
    }
  }

  setPosition(x: number, y: number): void {
    if (this.destroyed) return;
    this.container.position.set(x, y);
    this.container.zIndex = y;
  }

  showBubble(text: string): void {
    if (this.destroyed) return;
    if (this.bubble) {
      this.container.removeChild(this.bubble);
      this.bubble.destroy({ children: true });
    }
    const bubble = makeBubble(text);
    bubble.y = -FRAME - 6;
    this.container.addChild(bubble);
    this.bubble = bubble;
    this.bubbleExpiry = performance.now() + BUBBLE_MS;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.container.destroy({ children: true });
  }
}

import { Application, Container, Graphics, Sprite, Texture, TilingSprite } from 'pixi.js';
import type { TownPeer } from '@protoimsg/shared';
import { GAME_MASTER_DID, RPG_ACTOR_API_URL } from '../lib/config';
import { resolveDisplayNameForDid } from '../lib/resolve-pds';
import { Avatar, DIR_BACK, DIR_FORWARD, DIR_LEFT, DIR_RIGHT, buildFrames } from './Avatar';
import { ASSET_BASE, MAP_H, MAP_W, OBJECTS, OBJ_SCALE, TILE, isBlockedAtPixel } from './map';

const SCALE = 2; // world zoom
const SPEED = 132; // px/sec
const MOVE_SEND_MS = 110; // position broadcast throttle
const PEER_SNAP_DIST = 240; // snap a peer instead of interpolating past this
const PEER_LERP = 11; // peer position ease rate (per second)
const MAX_FRAME_MS = 50; // clamp delta time — avoids tunneling on stalls

function spriteUrl(did: string): string {
  return `${RPG_ACTOR_API_URL}/api/sprite/normalized?did=${encodeURIComponent(did)}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      resolve(img);
    };
    img.onerror = () => {
      reject(new Error(`failed to load ${src}`));
    };
    img.src = src;
  });
}

async function loadTexture(src: string): Promise<Texture | null> {
  try {
    const tex = Texture.from(await loadImage(src));
    tex.source.scaleMode = 'nearest';
    return tex;
  } catch {
    return null;
  }
}

interface Peer {
  avatar: Avatar;
  x: number;
  y: number;
  tx: number;
  ty: number;
}

const MOVE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'd', 'w', 's']);

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * PixiJS renderer for proto town: grass ground + objects + a keyboard-driven
 * local player and interpolated remote peers, with chat bubbles.
 */
export class WorldEngine {
  private app = new Application();
  private world = new Container();
  private player = new Avatar('');
  private peers = new Map<string, Peer>();
  private keys = new Set<string>();
  private fallbackTex: Texture | null = null;
  private ownedTextures: Texture[] = [];
  private selfDid = '';

  private px = MAP_W * TILE * 0.5;
  private py = MAP_H * TILE * 0.5;
  private sentX = -1;
  private sentY = -1;
  private sentDir = -1;
  private sendAccumMs = 0;

  private inputEnabled = true;
  private destroyed = false;
  private ready = false;
  private readyPromise: Promise<void>;
  private resolveReady: () => void = () => {};

  /** Called (throttled) when the local player moves. */
  onMove?: (x: number, y: number, dir: number) => void;

  constructor() {
    this.readyPromise = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });
  }

  async init(container: HTMLElement, did: string): Promise<void> {
    this.selfDid = did;
    await this.app.init({
      resizeTo: container,
      background: 0x6b8f3a,
      antialias: false,
      roundPixels: true,
    });
    if (this.destroyed) {
      this.app.destroy();
      return;
    }
    this.ready = true;
    this.app.canvas.style.display = 'block';
    container.appendChild(this.app.canvas);

    this.world.scale.set(SCALE);
    this.world.sortableChildren = true;
    this.app.stage.addChild(this.world);

    this.fallbackTex = this.makePortalTexture();

    await this.buildScene(did);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.app.ticker.add(this.tick);
    this.resolveReady();
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  getPosition(): { x: number; y: number; dir: number } {
    return { x: this.px, y: this.py, dir: this.player.dir };
  }

  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    if (!enabled) this.keys.clear();
  }

  private async buildScene(did: string): Promise<void> {
    const [grass, pine, pond] = await Promise.all([
      loadTexture(`${ASSET_BASE}/grass.png`),
      loadTexture(`${ASSET_BASE}/pine.png`),
      loadTexture(`${ASSET_BASE}/pond.png`),
    ]);
    if (this.destroyed) return;
    for (const t of [grass, pine, pond]) {
      if (t) this.ownedTextures.push(t);
    }

    if (grass) {
      const ground = new TilingSprite({
        texture: grass,
        width: MAP_W * TILE,
        height: MAP_H * TILE,
      });
      ground.zIndex = -10000;
      this.world.addChild(ground);
    }

    for (const o of OBJECTS) {
      if (o.type === 'pond' && pond) {
        const s = new Sprite(pond);
        s.anchor.set(0, 0);
        s.scale.set(OBJ_SCALE);
        s.position.set(o.tx * TILE, o.ty * TILE);
        s.zIndex = -5000;
        this.world.addChild(s);
      } else if (o.type === 'pine' && pine) {
        const s = new Sprite(pine);
        s.anchor.set(0.5, 1);
        s.scale.set(OBJ_SCALE);
        const baseY = o.ty * TILE + TILE;
        s.position.set(o.tx * TILE + TILE / 2, baseY);
        s.zIndex = baseY;
        this.world.addChild(s);
      }
    }

    if (this.fallbackTex) this.player.setFallbackTexture(this.fallbackTex);
    this.player.setPosition(this.px, this.py);
    this.world.addChild(this.player.container);
    void this.dressAvatar(this.player, did);
  }

  /**
   * Procedural 16×16 pixel-art portal — drawn once at startup, then rotated by
   * each Avatar showing it while its real rpg.actor sprite is still loading.
   */
  private makePortalTexture(): Texture {
    const SIZE = 16;
    const grid: string[][] = Array.from({ length: SIZE }, () => new Array<string>(SIZE).fill(' '));
    const cx = 7.5;
    const cy = 7.5;
    const setPx = (x: number, y: number, c: string): void => {
      if (x >= 0 && x < SIZE && y >= 0 && y < SIZE) {
        const row = grid[y];
        if (row) row[x] = c;
      }
    };
    // Outer disc + mid ring (concentric rings, dark→purple inward).
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d < 7.2) setPx(x, y, '.');
        if (d < 5.6) setPx(x, y, 'b');
      }
    }
    // Two opposing spiral arms — the asymmetry makes rotation visible.
    for (let t = 0; t < Math.PI * 2.4; t += 0.18) {
      const r = 0.6 + t * 0.95;
      setPx(Math.round(cx + r * Math.cos(t)), Math.round(cy + r * Math.sin(t)), 'P');
      setPx(
        Math.round(cx + r * Math.cos(t + Math.PI)),
        Math.round(cy + r * Math.sin(t + Math.PI)),
        'c',
      );
    }
    // Bright core.
    setPx(7, 7, 'W');
    setPx(8, 7, 'W');
    setPx(7, 8, 'W');
    setPx(8, 8, 'W');

    const COLORS: Record<string, number> = {
      '.': 0x2a0e3a,
      b: 0x5a2080,
      P: 0xc068ff,
      c: 0x66d8ff,
      W: 0xffffff,
    };
    const gfx = new Graphics();
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const row = grid[y];
        if (!row) continue;
        const c = row[x];
        if (!c || c === ' ') continue;
        const color = COLORS[c];
        if (color !== undefined) gfx.rect(x, y, 1, 1).fill(color);
      }
    }
    const tex = this.app.renderer.generateTexture({
      target: gfx,
      resolution: 1,
      antialias: false,
    });
    tex.source.scaleMode = 'nearest';
    gfx.destroy();
    return tex;
  }

  /** Load a DID's rpg.actor sprite + display name onto an avatar. */
  private async dressAvatar(avatar: Avatar, did: string): Promise<void> {
    let img: HTMLImageElement | null = null;
    try {
      img = await loadImage(spriteUrl(did));
    } catch {
      img = await loadImage(spriteUrl(GAME_MASTER_DID)).catch(() => null);
    }
    if (!this.destroyed && img) {
      const base = Texture.from(img);
      base.source.scaleMode = 'nearest';
      this.ownedTextures.push(base);
      avatar.setFrames(buildFrames(base));
    }

    const name = await resolveDisplayNameForDid(did).catch(() => null);
    if (!this.destroyed && name) avatar.setName(name);
  }

  // ── Peer management ───────────────────────────────────────────────────

  setPeers(peers: TownPeer[]): void {
    for (const p of this.peers.values()) p.avatar.destroy();
    this.peers.clear();
    for (const p of peers) this.peerJoin(p);
  }

  peerJoin(p: TownPeer): void {
    if (p.did === this.selfDid || this.peers.has(p.did)) return;
    const avatar = new Avatar('');
    avatar.dir = p.dir;
    if (this.fallbackTex) avatar.setFallbackTexture(this.fallbackTex);
    avatar.setPosition(p.x, p.y);
    this.world.addChild(avatar.container);
    this.peers.set(p.did, { avatar, x: p.x, y: p.y, tx: p.x, ty: p.y });
    void this.dressAvatar(avatar, p.did);
  }

  peerMove(p: TownPeer): void {
    const peer = this.peers.get(p.did);
    if (!peer) {
      this.peerJoin(p);
      return;
    }
    peer.tx = p.x;
    peer.ty = p.y;
    peer.avatar.dir = p.dir;
  }

  peerLeave(did: string): void {
    const peer = this.peers.get(did);
    if (!peer) return;
    peer.avatar.destroy();
    this.peers.delete(did);
  }

  showChat(did: string, text: string): void {
    if (did === this.selfDid) {
      this.player.showBubble(text);
      return;
    }
    this.peers.get(did)?.avatar.showBubble(text);
  }

  // ── Input ─────────────────────────────────────────────────────────────

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.inputEnabled || !MOVE_KEYS.has(e.key)) return;
    this.keys.add(e.key);
    e.preventDefault();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key);
  };

  // ── Frame loop ────────────────────────────────────────────────────────

  private tick = (): void => {
    // Clamp delta — a tab-blur/GC stall otherwise produces one huge step that
    // tunnels the player through one-tile-thick collision footprints.
    const dtMs = Math.min(this.app.ticker.deltaMS, MAX_FRAME_MS);
    const dt = dtMs / 1000;

    let dx = 0;
    let dy = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('a')) dx -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('d')) dx += 1;
    if (this.keys.has('ArrowUp') || this.keys.has('w')) dy -= 1;
    if (this.keys.has('ArrowDown') || this.keys.has('s')) dy += 1;

    const moving = dx !== 0 || dy !== 0;
    if (moving) {
      if (Math.abs(dx) > Math.abs(dy)) this.player.dir = dx < 0 ? DIR_LEFT : DIR_RIGHT;
      else this.player.dir = dy < 0 ? DIR_BACK : DIR_FORWARD;

      const len = Math.hypot(dx, dy) || 1;
      const step = (SPEED * dt) / len;
      const nx = this.px + dx * step;
      const ny = this.py + dy * step;
      if (!isBlockedAtPixel(nx, this.py)) this.px = clamp(nx, TILE, (MAP_W - 1) * TILE);
      if (!isBlockedAtPixel(this.px, ny)) this.py = clamp(ny, TILE, (MAP_H - 1) * TILE);
    }
    this.player.tick(dtMs, moving);
    this.player.setPosition(this.px, this.py);

    // Throttled position broadcast (sends the resting position too, since the
    // changed-check stays true until the latest pose is acknowledged).
    this.sendAccumMs += dtMs;
    const changed =
      this.px !== this.sentX || this.py !== this.sentY || this.player.dir !== this.sentDir;
    if (changed && this.sendAccumMs >= MOVE_SEND_MS) {
      this.sendAccumMs = 0;
      this.sentX = this.px;
      this.sentY = this.py;
      this.sentDir = this.player.dir;
      this.onMove?.(this.px, this.py, this.player.dir);
    }

    // Peers: interpolate toward their last reported position.
    for (const peer of this.peers.values()) {
      const pdx = peer.tx - peer.x;
      const pdy = peer.ty - peer.y;
      const dist = Math.hypot(pdx, pdy);
      let peerMoving = false;
      if (dist > 0.5) {
        peerMoving = true;
        if (dist > PEER_SNAP_DIST) {
          peer.x = peer.tx;
          peer.y = peer.ty;
        } else {
          // Ease toward the latest reported position — smoother than chasing
          // at literal walk speed (which stutters between packets).
          const f = Math.min(1, dt * PEER_LERP);
          peer.x += pdx * f;
          peer.y += pdy * f;
        }
      }
      peer.avatar.tick(dtMs, peerMoving);
      peer.avatar.setPosition(peer.x, peer.y);
    }

    this.world.position.set(
      this.app.screen.width / 2 - this.px * SCALE,
      this.app.screen.height / 2 - this.py * SCALE,
    );
  };

  destroy(): void {
    this.destroyed = true;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    if (this.ready) {
      this.app.ticker.remove(this.tick);
      this.app.destroy({ removeView: true }, { children: true, texture: false });
    }
    // Free GPU memory — these base textures are shared by frame sub-textures
    // and are not released by app.destroy({ texture: false }).
    for (const t of this.ownedTextures) t.destroy(true);
    this.ownedTextures = [];
    this.fallbackTex?.destroy(true);
    this.fallbackTex = null;
  }
}

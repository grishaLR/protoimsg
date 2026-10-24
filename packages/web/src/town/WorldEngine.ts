// CSP-friendly shader path — our `script-src` does not allow `unsafe-eval`,
// and Pixi v8's default shader system uses Function() to compile shaders.
// This side-effect import swaps in a precompiled runtime.
import 'pixi.js/unsafe-eval';
import {
  Application,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
  TilingSprite,
  type FederatedPointerEvent,
} from 'pixi.js';
import {
  TOWN_PROXIMITY,
  TOWN_SQUARE_LAYOUT,
  townArrival,
  townDoorwayAtTile,
} from '@protoimsg/shared';
import type { TownDoorway, TownGate, TownPeer, TownSceneKind, TownSpawn } from '@protoimsg/shared';
import { GAME_MASTER_DID, RPG_ACTOR_API_URL } from '../lib/config';
import { resolveDisplayNameForDid } from '../lib/resolve-pds';
import {
  Avatar,
  DIR_BACK,
  DIR_FORWARD,
  FRAME,
  DIR_LEFT,
  DIR_RIGHT,
  SPRITE_H,
  buildFrames,
} from './Avatar';
import { buildStructures, buildWindowGlow, sceneSigns, type SignId } from './structures';
import { ASSET_BASE, OBJ_SCALE, SCENE_MAPS, TILE, gateSlotAt, type SceneMap } from './map';

export type { SignId };

const SCALE = 2; // world zoom
const SPEED = 132; // px/sec
const MOVE_SEND_MS = 110; // position broadcast throttle
const PEER_SNAP_DIST = 240; // snap a peer instead of interpolating past this
const PEER_LERP = 11; // peer position ease rate (per second)
const MAX_FRAME_MS = 50; // clamp delta time — avoids tunneling on stalls

// Proximity aura mesh — drawn between everyone in your voice cluster.
// Anyone merely nearby (not in your voice room yet) gets a softer violet aura,
// so closeness is always visible; the connected mesh is brighter and bolder.
const NEAR_COLOR = 0x9f6bff;
const AURA_COLOR = 0xb794ff;
const AURA_SPEAKING = 0xf0e6ff;
const AURA_R = 15; // world px around the body centre
const MESH_Z = -4000; // above ground + pond, below y-sorted avatars/trees
const SIGN_Z = 9000; // door signs float over everything that walks

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
 * World offset on one axis: follow the player, but stop at the map's edges —
 * and centre a map smaller than the screen (a room) instead of scrolling it.
 */
function cameraOffset(screen: number, mapSize: number, player: number): number {
  if (mapSize <= screen) return Math.round((screen - mapSize) / 2);
  return Math.round(clamp(screen / 2 - player, screen - mapSize, 0));
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
  private mesh = new Graphics();
  private cluster: string[] = [];
  private speaking = new Set<string>();
  private meshClock = 0;
  private meshDrawn = false;
  /** Peers within proximity range of you (join/leave hysteresis, like the server). */
  private nearby = new Set<string>();
  private nearbyUnlinked = 0;

  /** Current scene: its map, and every display object built for it. */
  private map: SceneMap = SCENE_MAPS.home;
  private sceneNodes: Container[] = [];
  private textures: { grass: Texture | null; pine: Texture | null; pond: Texture | null } = {
    grass: null,
    pine: null,
    pond: null,
  };
  private signTexts = new Map<SignId, Text>();
  /** Text for each sign — supplied by the panel (it owns i18n and names). */
  private signText: (id: SignId) => string = () => '';
  /** The square's gate row: open slots are doorways, the rest stay fence. */
  private gates: TownGate[] = [];
  private openSlots = new Set<number>();
  private hasMoreGates = false;
  private onSignpostTile = false;
  /** Each gate owner's front-facing frame, loaded once per DID. */
  private gateFrames = new Map<string, Promise<Texture | null>>();
  /** The default sprite sheet, shared by every owner without one. */
  private defaultSheet: Promise<Texture | null> | null = null;
  /** Frame sub-textures we made (destroyed before their sheets). */
  private frameTextures: Texture[] = [];
  /** The neighborhood house's lit windows (shown while its owner is home to you). */
  private windowGlow: Container | null = null;
  private windowLit = false;
  /** Bumped per scene build: async work from an older build drops its result. */
  private sceneGen = 0;
  /** Doorways fire only when walked onto — not when you arrive standing on one. */
  private doorArmed = false;
  /** Waiting on a doorway hand-off: movement and further doorways are paused. */
  private atDoor = false;
  private lastSafe = { x: 0, y: 0 };

  private px = 0;
  private py = 0;
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

  /** Called when the local player steps onto a doorway into another scene. */
  onDoorway?: (door: TownDoorway) => void;

  /** Stepped onto (true) or off (false) the square's signpost. */
  onSignpost?: (on: boolean) => void;

  /** Count of nearby avatars you are NOT in a voice room with changed. */
  onNearbyUnlinkedChange?: (count: number) => void;

  /**
   * Pointer over / tapped a door sign (screen px relative to the canvas),
   * or null when the pointer leaves it.
   */
  onSignHover?: (sign: SignId | null, x: number, y: number) => void;

  constructor() {
    this.readyPromise = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });
  }

  async init(container: HTMLElement, did: string, kind: TownSceneKind): Promise<void> {
    this.selfDid = did;
    this.map = SCENE_MAPS[kind];
    const spawn = townArrival(kind, null);
    this.px = spawn.x;
    this.py = spawn.y;
    this.player.dir = spawn.dir;
    await this.app.init({
      resizeTo: container,
      background: this.map.background,
      antialias: false,
      roundPixels: true,
    });
    if (this.destroyed) {
      this.app.destroy();
      return;
    }
    this.ready = true;
    // 120 Hz displays would otherwise render twice as often for no visible gain,
    // competing with video encode/decode for CPU.
    this.app.ticker.maxFPS = 60;
    this.app.canvas.style.display = 'block';
    container.appendChild(this.app.canvas);

    this.world.scale.set(SCALE);
    this.world.sortableChildren = true;
    this.app.stage.addChild(this.world);

    const fallback = this.makePortalTexture();
    this.fallbackTex = fallback;

    this.mesh.zIndex = MESH_Z;
    this.world.addChild(this.mesh);

    if (!(await this.loadAssets())) return;
    this.player.setFallbackTexture(fallback);
    this.world.addChild(this.player.container);
    void this.dressAvatar(this.player, did);
    this.buildScene();

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

  /** How to label signs; call `refreshSigns` when the answers change. */
  setSignText(fn: (id: SignId) => string): void {
    this.signText = fn;
    this.refreshSigns();
  }

  /** Re-read every sign's text (language changed, a name resolved, …). */
  refreshSigns(): void {
    for (const [id, text] of this.signTexts) text.text = this.signText(id);
  }

  /** Light (or darken) the windows of the house you're outside. */
  setWindowLit(lit: boolean): void {
    this.windowLit = lit;
    if (this.windowGlow) this.windowGlow.visible = lit;
  }

  /** The square's gate row (and whether the signpost lists more). */
  setGates(gates: TownGate[], hasMore: boolean): void {
    this.gates = gates;
    this.openSlots = new Set(gates.map((g) => g.slot));
    this.hasMoreGates = hasMore;
    if (!this.ready || this.destroyed || this.map.kind !== 'square') return;
    // Redraw the square around the player — they may be mid-doorway or
    // reading the signpost list, which a scene entry would reset.
    this.buildScene(false);
    if (!hasMore && this.onSignpostTile) {
      this.onSignpostTile = false;
      this.onSignpost?.(false);
    }
  }

  /**
   * Swap to another scene: tear down the old one (and its peers — they belong
   * to that scene), build the new one and stand the player at `spawn`.
   */
  enterScene(kind: TownSceneKind, spawn: TownSpawn): void {
    if (!this.ready || this.destroyed) return;
    this.setPeers([]);
    this.nearby.clear();
    this.cluster = [];
    this.map = SCENE_MAPS[kind];
    this.app.renderer.background.color = this.map.background;
    this.px = spawn.x;
    this.py = spawn.y;
    this.player.dir = spawn.dir;
    this.sentX = this.px;
    this.sentY = this.py;
    this.sentDir = this.player.dir;
    this.buildScene();
  }

  /** The doorway hand-off failed — step back off the doorway and walk on. */
  leaveDoorway(): void {
    this.atDoor = false;
    this.keys.clear(); // a key held through the wait shouldn't walk you straight back
    this.doorArmed = false;
    this.px = this.lastSafe.x;
    this.py = this.lastSafe.y;
  }

  private buildSignLabels(): void {
    this.signTexts.clear();
    for (const pos of sceneSigns(this.map.kind, this.gates, this.hasMoreGates)) {
      const sign = pos.id;
      const label = new Text({
        text: this.signText(sign),
        style: {
          fontFamily: 'monospace',
          fontSize: 10,
          fontWeight: 'bold',
          fill: 0xffffff,
          stroke: { color: 0x1a1726, width: 3 },
          letterSpacing: 1,
        },
      });
      label.anchor.set(0.5, pos.anchorY);
      label.position.set(pos.x, pos.y);
      label.zIndex = SIGN_Z;
      // Hover (desktop) or tap (touch) explains where the door goes.
      label.eventMode = 'static';
      label.cursor = 'help';
      const show = (e: FederatedPointerEvent): void => {
        this.onSignHover?.(sign, e.global.x, e.global.y);
      };
      label.on('pointerover', show);
      label.on('pointertap', show);
      label.on('pointerout', () => {
        this.onSignHover?.(null, 0, 0);
      });
      this.signTexts.set(sign, label);
      this.addSceneNode(label);
      // Someone else's gate also shows them, standing above their name.
      const owner = sign.startsWith('gate:') ? sign.slice(5) : null;
      if (owner && owner !== this.selfDid) void this.addGateAvatar(owner, pos.x, pos.y - 14);
    }
  }

  private async addGateAvatar(owner: string, x: number, y: number): Promise<void> {
    const gen = this.sceneGen;
    let frame = this.gateFrames.get(owner);
    if (!frame) {
      frame = this.loadGateFrame(owner);
      this.gateFrames.set(owner, frame);
    }
    const tex = await frame;
    // The square was rebuilt (or left) while it loaded — that build has its own.
    if (!tex || this.destroyed || gen !== this.sceneGen) return;
    const s = new Sprite(tex);
    s.anchor.set(0.5, 1);
    s.scale.set(0.5);
    s.position.set(x, y);
    s.zIndex = SIGN_Z;
    this.addSceneNode(s);
  }

  /** One front-facing frame of `owner`'s sheet (the default sheet if they have none). */
  private async loadGateFrame(owner: string): Promise<Texture | null> {
    let sheet = await loadTexture(spriteUrl(owner));
    if (sheet) this.ownedTextures.push(sheet);
    else {
      this.defaultSheet ??= loadTexture(spriteUrl(GAME_MASTER_DID)).then((t) => {
        if (t) this.ownedTextures.push(t);
        return t;
      });
      sheet = await this.defaultSheet;
    }
    if (!sheet || this.destroyed) return null;
    const tex = new Texture({
      source: sheet.source,
      frame: new Rectangle(0, DIR_FORWARD * FRAME, FRAME, FRAME),
    });
    this.frameTextures.push(tex);
    return tex;
  }

  /** Blocked for walking: the map's own collision, plus closed gate slots. */
  private isBlocked(tx: number, ty: number): boolean {
    if (this.map.isBlockedTile(tx, ty)) return true;
    if (this.map.kind !== 'square') return false;
    const slot = gateSlotAt(tx, ty);
    return slot !== null && !this.openSlots.has(slot);
  }

  private addSceneNode(node: Container): void {
    this.sceneNodes.push(node);
    this.world.addChild(node);
  }

  /** DIDs sharing your voice room (including you); [] clears the mesh. */
  setVoiceCluster(dids: string[]): void {
    this.cluster = dids;
  }

  setSpeaking(dids: Set<string>): void {
    this.speaking = dids;
  }

  /** World-px distance from you to a peer, or null if they're not in view. */
  distanceTo(did: string): number | null {
    const p = this.positionOf(did);
    return p ? Math.hypot(p.x - this.px, p.y - this.py) : null;
  }

  private positionOf(did: string): { x: number; y: number } | null {
    if (did === this.selfDid) return { x: this.px, y: this.py };
    const p = this.peers.get(did);
    return p ? { x: p.x, y: p.y } : null;
  }

  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    if (!enabled) this.keys.clear();
  }

  /** Load shared textures; false if the engine was destroyed meanwhile. */
  private async loadAssets(): Promise<boolean> {
    const [grass, pine, pond] = await Promise.all([
      loadTexture(`${ASSET_BASE}/graphics/grass-tile.png`),
      loadTexture(`${ASSET_BASE}/objects/pine.png`),
      loadTexture(`${ASSET_BASE}/objects/pond.png`),
    ]);
    for (const t of [grass, pine, pond]) {
      if (t) this.ownedTextures.push(t);
    }
    this.textures = { grass, pine, pond };
    return !this.destroyed;
  }

  /**
   * Build the current scene's ground, structures, objects and signs.
   * `enter` = a fresh arrival: also reset the player's doorway/signpost state.
   */
  private buildScene(enter = true): void {
    this.sceneGen++;
    // `context: true` frees each Graphics' geometry; textures are shared, keep them.
    for (const node of this.sceneNodes) node.destroy({ children: true, context: true });
    this.sceneNodes = [];
    this.onSignHover?.(null, 0, 0);
    const { grass, pine, pond } = this.textures;
    const map = this.map;

    if (grass && map.grassTint !== null) {
      const ground = new TilingSprite({
        texture: grass,
        width: map.w * TILE,
        height: map.h * TILE,
      });
      ground.tint = map.grassTint;
      ground.zIndex = -10000;
      this.addSceneNode(ground);
    }

    for (const piece of buildStructures(map.kind, this.openSlots, this.hasMoreGates)) {
      this.addSceneNode(piece);
    }
    this.windowGlow = null;
    if (map.kind === 'neighborhood') {
      this.windowGlow = buildWindowGlow();
      this.windowGlow.visible = this.windowLit;
      this.addSceneNode(this.windowGlow);
    }
    this.buildSignLabels();

    for (const o of map.objects) {
      if (o.type === 'pond' && pond) {
        const s = new Sprite(pond);
        s.anchor.set(0, 0);
        s.scale.set(OBJ_SCALE);
        s.position.set(o.tx * TILE, o.ty * TILE);
        s.zIndex = -5000;
        this.addSceneNode(s);
      } else if (o.type === 'pine' && pine) {
        const s = new Sprite(pine);
        s.anchor.set(0.5, 1);
        s.scale.set(OBJ_SCALE);
        const baseY = o.ty * TILE + TILE;
        s.position.set(o.tx * TILE + TILE / 2, baseY);
        s.zIndex = baseY;
        this.addSceneNode(s);
      }
    }

    this.player.setPosition(this.px, this.py);
    if (!enter) return;
    this.lastSafe = { x: this.px, y: this.py };
    this.doorArmed = false;
    this.atDoor = false;
    if (this.onSignpostTile) {
      this.onSignpostTile = false;
      this.onSignpost?.(false);
    }
  }

  /** Hold still while a hand-off not started from a doorway (the signpost) runs. */
  freeze(): void {
    this.atDoor = true;
    this.keys.clear();
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

    const moving = !this.atDoor && (dx !== 0 || dy !== 0);
    if (moving) {
      if (Math.abs(dx) > Math.abs(dy)) this.player.dir = dx < 0 ? DIR_LEFT : DIR_RIGHT;
      else this.player.dir = dy < 0 ? DIR_BACK : DIR_FORWARD;

      const len = Math.hypot(dx, dy) || 1;
      const step = (SPEED * dt) / len;
      const nx = this.px + dx * step;
      const ny = this.py + dy * step;
      const map = this.map;
      if (!this.isBlocked(Math.floor(nx / TILE), Math.floor(this.py / TILE))) {
        this.px = clamp(nx, TILE, (map.w - 1) * TILE);
      }
      if (!this.isBlocked(Math.floor(this.px / TILE), Math.floor(ny / TILE))) {
        this.py = clamp(ny, TILE, (map.h - 1) * TILE);
      }
    }
    this.player.tick(dtMs, moving);
    this.player.setPosition(this.px, this.py);
    this.checkDoorway();

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
      // Whole pixels: sub-pixel jitter isn't worth a network message.
      this.onMove?.(Math.round(this.px), Math.round(this.py), this.player.dir);
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

    this.drawMesh(dtMs);

    this.world.position.set(
      cameraOffset(this.app.screen.width, this.map.w * TILE * SCALE, this.px * SCALE),
      cameraOffset(this.app.screen.height, this.map.h * TILE * SCALE, this.py * SCALE),
    );
  };

  private checkDoorway(): void {
    const tx = Math.floor(this.px / TILE);
    const ty = Math.floor(this.py / TILE);
    const sp = TOWN_SQUARE_LAYOUT.signpost;
    const onPost = this.map.kind === 'square' && this.hasMoreGates && tx === sp.x && ty === sp.y;
    if (onPost !== this.onSignpostTile) {
      this.onSignpostTile = onPost;
      this.onSignpost?.(onPost);
    }

    const door = townDoorwayAtTile(this.map.kind, tx, ty);
    if (!door) {
      this.doorArmed = true;
      this.lastSafe = { x: this.px, y: this.py };
      return;
    }
    if (!this.doorArmed || this.atDoor) return;
    this.atDoor = true;
    this.keys.clear();
    this.onDoorway?.(door);
  }

  private updateNearby(): void {
    const { joinRadius, leaveRadius } = TOWN_PROXIMITY;
    for (const [did, p] of this.peers) {
      const d = Math.hypot(p.x - this.px, p.y - this.py);
      if (d < joinRadius) this.nearby.add(did);
      else if (d > leaveRadius) this.nearby.delete(did);
    }
    for (const did of this.nearby) if (!this.peers.has(did)) this.nearby.delete(did);
  }

  /**
   * Two layers: a soft white aura linking you to anyone nearby you aren't in a
   * voice room with, and the colorful mesh (rings, threads, speaking pulse)
   * for everyone you are connected to.
   */
  private drawMesh(dtMs: number): void {
    const g = this.mesh;
    this.updateNearby();
    const linked = new Set(this.cluster.length >= 2 ? this.cluster : []);
    const unlinked = [...this.nearby].filter((did) => !linked.has(did));
    if (unlinked.length !== this.nearbyUnlinked) {
      this.nearbyUnlinked = unlinked.length;
      this.onNearbyUnlinkedChange?.(unlinked.length);
    }

    const points: Array<{ x: number; y: number; speaking: boolean }> = [];
    for (const did of linked) {
      const pos = this.positionOf(did);
      if (pos) points.push({ x: pos.x, y: pos.y - SPRITE_H / 2, speaking: this.speaking.has(did) });
    }
    if (points.length < 2 && unlinked.length === 0) {
      // Clearing rebuilds the Graphics context — skip it on idle frames.
      if (this.meshDrawn) g.clear();
      this.meshDrawn = false;
      return;
    }
    g.clear();
    this.meshDrawn = true;

    this.meshClock += dtMs;
    const pulse = 0.5 + 0.5 * Math.sin(this.meshClock / 420);

    // Soft proximity aura: you + each nearby-but-not-connected avatar.
    if (unlinked.length > 0) {
      const self = { x: this.px, y: this.py - SPRITE_H / 2 };
      const near = unlinked.flatMap((did) => {
        const pos = this.positionOf(did);
        return pos ? [{ x: pos.x, y: pos.y - SPRITE_H / 2 }] : [];
      });
      for (const p of near) {
        g.moveTo(self.x, self.y)
          .lineTo(p.x, p.y)
          .stroke({ width: 1, color: NEAR_COLOR, alpha: 0.35 + 0.15 * pulse });
      }
      const selfLinked = linked.has(this.selfDid);
      for (const p of selfLinked ? near : [self, ...near]) {
        g.circle(p.x, p.y, AURA_R).fill({ color: NEAR_COLOR, alpha: 0.18 });
        g.circle(p.x, p.y, AURA_R).stroke({ width: 1, color: NEAR_COLOR, alpha: 0.7 });
      }
    }
    if (points.length < 2) return;

    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i];
        const b = points[j];
        if (!a || !b) continue;
        const live = a.speaking || b.speaking;
        g.moveTo(a.x, a.y)
          .lineTo(b.x, b.y)
          .stroke({
            width: live ? 2 : 1.5,
            color: live ? AURA_SPEAKING : AURA_COLOR,
            alpha: live ? 0.95 : 0.55 + 0.2 * pulse,
          });
      }
    }
    for (const p of points) {
      const r = AURA_R + (p.speaking ? 2 + 2 * pulse : pulse);
      g.circle(p.x, p.y, r).fill({ color: AURA_COLOR, alpha: p.speaking ? 0.38 : 0.26 });
      g.circle(p.x, p.y, r).stroke({
        width: 1.5,
        color: p.speaking ? AURA_SPEAKING : AURA_COLOR,
        alpha: p.speaking ? 1 : 0.85,
      });
    }
  }

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
    for (const t of this.frameTextures) t.destroy();
    this.frameTextures = [];
    for (const t of this.ownedTextures) t.destroy(true);
    this.ownedTextures = [];
    this.fallbackTex?.destroy(true);
    this.fallbackTex = null;
  }
}

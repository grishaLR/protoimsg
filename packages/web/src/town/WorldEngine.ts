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
  type FederatedPointerEvent,
} from 'pixi.js';
import {
  TOWN_BUILD_AREA,
  TOWN_BUILTINS,
  TOWN_MAX_PLACEMENTS,
  TOWN_PROXIMITY,
  TOWN_SQUARE_LAYOUT,
  townArrival,
  townBuiltin,
  townDoorwayAtTile,
  townFootprint,
  validateTownLayout,
} from '@protoimsg/shared';
import type {
  TownBuiltinId,
  TownDoorway,
  TownGate,
  TownPeer,
  TownPlacement,
  TownSceneKind,
  TownSpace,
  TownSpawn,
} from '@protoimsg/shared';
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
import {
  buildLampGlow,
  buildStructures,
  buildWindowGlow,
  drawPlacement,
  sceneSigns,
  type SignId,
} from './structures';
import { OPENPIXELS_SHEET, OpenPixels } from './openpixels';
import {
  ASSET_BASE,
  OBJ_SCALE,
  SCENE_MAPS,
  SPRITE_PIECES,
  TILE,
  gateSlotAt,
  layoutBlocks,
  sceneSpace,
  type SceneMap,
} from './map';

export type { SignId };

const SCALE = 2; // world zoom
const SPEED = 132; // px/sec
// Holding Space: faster on foot, legs to match.
const SPRINT = 1.75;
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

// Build mode: the grid, the piece you're about to place, the piece you'd remove.
const GRID_Z = -4300; // over the floor and rugs, under everything solid
const GRID_COLOR = 0xffffff;
const GHOST_OK = 0x7ee08a;
const GHOST_BAD = 0xff6b6b;
const REMOVE_COLOR = 0xffc14d;

/** What build mode shows the panel: where, and which piece is in hand. */
export interface TownBuildView {
  space: TownSpace;
  items: TownBuiltinId[];
  item: TownBuiltinId;
  /** The piece in hand fits where it's aimed. */
  canPlace: boolean;
  /** The piece in hand turns. */
  canRotate: boolean;
  /** There's a piece where you're aiming to pick up and move. */
  canPickUp: boolean;
  /** There's something to take away: the piece aimed at, or the one carried. */
  canRemove: boolean;
  /** Carrying a piece you picked up (Escape puts it back). */
  carrying: boolean;
  full: boolean;
}

export type TownBuildAction =
  | 'placed'
  | 'removed'
  | 'blocked'
  | 'full'
  | 'pickedUp'
  | 'putBack'
  | 'rotated';

const BUILD_KEY = 'b';
const ROTATE_KEY = 'r';
const PICK_UP_KEY = 'e';

/**
 * Build keys belong to the town: the page itself, or anywhere in the town
 * panel except its cards and lists (the signpost, a knock), which keep their
 * own Escape and Delete. The tray (`data-town-build`) is the town's.
 */
function buildKeysApply(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement) || target === document.body) return true;
  if (!target.closest('[data-town-root]')) return false;
  const card = target.closest('section, dialog, [role="dialog"]');
  return !card || card.hasAttribute('data-town-build');
}

/** The starter pieces that fit a space, in catalog order. */
function buildItems(space: TownSpace): TownBuiltinId[] {
  return (Object.keys(TOWN_BUILTINS) as TownBuiltinId[]).filter((id) =>
    (TOWN_BUILTINS[id].spaces as readonly TownSpace[]).includes(space),
  );
}

function covers(p: TownPlacement, tx: number, ty: number): boolean {
  const fp = townFootprint(p);
  return !!fp && tx >= p.x && tx < p.x + fp.w && ty >= p.y && ty < p.y + fp.h;
}

function spriteUrl(did: string): string {
  return `${RPG_ACTOR_API_URL}/api/sprite/normalized?did=${encodeURIComponent(did)}`;
}

/** rpg.actor confirms this DID has no sprite (as opposed to being unreachable). */
async function spriteMissing(did: string): Promise<boolean> {
  try {
    // GET, not HEAD: only called after the image failed, so the body is an error.
    const res = await fetch(spriteUrl(did));
    return res.status === 404;
  } catch {
    return false;
  }
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
  /** Walk-cycle speed: 1 walking, SPRINT while they say they're running. */
  pace: number;
}

const MOVE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'd', 'w', 's']);
const SPRINT_KEY = ' ';

/** Focus is in somewhere you type — every key belongs to it. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest('input, textarea, select') !== null;
}

/**
 * Space presses a control only when the keyboard put focus there. A button
 * you clicked with the mouse keeps focus too, but Space should still sprint.
 */
function spaceBelongsToFocus(target: EventTarget | null): boolean {
  if (isTextEntry(target)) return true;
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('button, a, [role="button"]') !== null && target.matches(':focus-visible');
}

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
  /** The OpenPixels sheet everything in the world is drawn from. */
  private art: OpenPixels | null = null;
  /** Pack art for placeable pieces, by builtin id. */
  private pieceTextures = new Map<string, Texture>();
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

  /** The current scene's design (homes and yards), and what it blocks. */
  private layout: TownPlacement[] = [];
  private layoutBlocked = new Set<string>();
  private layoutNodes: Container[] = [];
  /** The space you may design here (your own home or yard), if any. */
  private buildable: TownSpace | null = null;
  /** Build mode: which piece is in hand (null = not building). */
  private build: {
    space: TownSpace;
    items: TownBuiltinId[];
    index: number;
    /** Quarter turns for the piece in hand. */
    rotation: number;
    /** Picked up to move: the layout as it was, to put it back on Escape. */
    carrying: { piece: TownPlacement; before: TownPlacement[] } | null;
  } | null = null;
  /** The on-screen joystick's push (touch), -1..1 each way, y up. */
  private stick = { x: 0, y: 0 };
  /** The tile under the mouse (or last tap) in build mode; null = aim in front of you. */
  private pointerTile: { x: number; y: number } | null = null;
  private buildGrid: Graphics | null = null;
  private buildGhost: Container | null = null;
  /** What the ghost was last drawn for, so it's only redrawn on change. */
  private ghostKey = '';
  /** Bumped whenever the layout changes (part of the ghost's key). */
  private layoutVersion = 0;
  /** The last view sent to the panel. */
  private lastView: TownBuildView | null = null;

  private px = 0;
  private py = 0;
  private sentX = -1;
  private sentY = -1;
  private sentDir = -1;
  private sentSprint = false;
  private sendAccumMs = 0;

  private inputEnabled = true;
  private destroyed = false;
  private ready = false;
  private readyPromise: Promise<void>;
  private resolveReady: () => void = () => {};

  /** Called (throttled) when the local player moves (or starts/stops running). */
  onMove?: (x: number, y: number, dir: number, sprint: boolean) => void;
  /** Your own sprite loaded: `borrowed` when you have no rpg.actor sprite yet. */
  onOwnSprite?: (borrowed: boolean) => void;

  /** Called when the local player steps onto a doorway into another scene. */
  onDoorway?: (door: TownDoorway) => void;

  /** Stepped onto (true) or off (false) the square's signpost. */
  onSignpost?: (on: boolean) => void;

  /** Build mode started, changed (piece, what's in front of you) or ended (null). */
  onBuildChange?: (view: TownBuildView | null) => void;

  /** Something happened in build mode worth saying out loud. */
  onBuildAction?: (action: TownBuildAction) => void;

  /** You changed your design: save it. */
  onLayoutEdit?: (space: TownSpace, placements: TownPlacement[]) => void;

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
    // Build mode aims and acts with the pointer too (mouse and touch).
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on('pointermove', this.onStagePointerMove);
    this.app.stage.on('pointerdown', this.onStagePointerDown);
    // Touches drive the avatar, not the page.
    this.app.canvas.style.touchAction = 'none';
    this.app.canvas.addEventListener('pointerleave', this.onCanvasPointerLeave);
    this.app.canvas.addEventListener('contextmenu', this.onCanvasContextMenu);

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
    window.addEventListener('blur', this.onBlur);
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
  enterScene(kind: TownSceneKind, spawn: TownSpawn, layout: TownPlacement[] = []): void {
    if (!this.ready || this.destroyed) return;
    this.endBuild();
    this.setPeers([]);
    this.nearby.clear();
    this.cluster = [];
    this.map = SCENE_MAPS[kind];
    this.setLayoutData(layout);
    this.app.renderer.background.color = this.map.background;
    this.px = spawn.x;
    this.py = spawn.y;
    this.player.dir = spawn.dir;
    this.sentX = this.px;
    this.sentY = this.py;
    this.sentDir = this.player.dir;
    this.buildScene();
  }

  /**
   * The scene's design changed (its owner saved). Ignored while you're
   * designing it yourself: your edits are newer than any echo of a save.
   */
  setLayout(placements: TownPlacement[]): void {
    if (this.build) return;
    this.setLayoutData(placements);
    if (!this.ready || this.destroyed) return;
    this.drawLayout();
    this.unstick();
  }

  private setLayoutData(placements: TownPlacement[]): void {
    const space = sceneSpace(this.map.kind);
    this.layout = space ? placements : [];
    this.layoutBlocked = layoutBlocks(this.layout);
    this.layoutVersion++;
  }

  /** B pressed where you may design: the panel loads your design and begins. */
  onBuildRequest?: () => void;

  /** Where you may design right now (null: nowhere — not your space). */
  setBuildable(space: TownSpace | null): void {
    this.buildable = space;
    if (this.build && this.build.space !== space) this.endBuild();
  }

  isBuilding(): boolean {
    return this.build !== null;
  }

  /**
   * Start designing with `placements` (the owner's own record, read fresh, so
   * a stale or default view is never what gets saved over their design).
   */
  beginBuild(placements: TownPlacement[]): void {
    if (this.build) return;
    this.setLayoutData(placements);
    if (this.ready && !this.destroyed) this.drawLayout();
    this.startBuild();
  }

  private startBuild(): void {
    const space = this.buildable;
    if (!space || space !== sceneSpace(this.map.kind) || !this.ready) return;
    this.build = { space, items: buildItems(space), index: 0, rotation: 0, carrying: null };
    this.pointerTile = null;
    const grid = new Graphics();
    const area = TOWN_BUILD_AREA[space];
    for (let x = area.x; x <= area.x + area.w; x++) {
      grid.moveTo(x * TILE, area.y * TILE).lineTo(x * TILE, (area.y + area.h) * TILE);
    }
    for (let y = area.y; y <= area.y + area.h; y++) {
      grid.moveTo(area.x * TILE, y * TILE).lineTo((area.x + area.w) * TILE, y * TILE);
    }
    grid.stroke({ width: 1, color: GRID_COLOR, alpha: 0.18 });
    grid.zIndex = GRID_Z;
    grid.eventMode = 'none';
    this.buildGrid = grid;
    this.world.addChild(grid);
    this.ghostKey = '';
    this.updateGhost();
  }

  /** Leave build mode (no-op when not building). A carried piece goes back. */
  endBuild(): void {
    if (!this.build) return;
    this.putBack();
    this.build = null;
    this.pointerTile = null;
    this.buildGrid?.destroy({ context: true });
    this.buildGrid = null;
    this.buildGhost?.destroy({ children: true, context: true });
    this.buildGhost = null;
    this.ghostKey = '';
    this.lastView = null;
    this.onBuildChange?.(null);
  }

  /** Take a different piece in hand (a carried one goes back first). */
  selectBuildItem(id: TownBuiltinId): void {
    if (!this.build) return;
    const i = this.build.items.indexOf(id);
    if (i < 0) return;
    this.putBack();
    if (i !== this.build.index) this.build.rotation = 0;
    this.build.index = i;
    this.updateGhost();
  }

  private cycleBuildItem(step: number): void {
    if (!this.build) return;
    this.putBack();
    const n = this.build.items.length;
    this.build.index = (this.build.index + step + n) % n;
    this.build.rotation = 0;
    this.updateGhost();
  }

  /** Turn the piece in hand a quarter turn clockwise. */
  rotateBuildItem(): void {
    const build = this.build;
    if (!build || !townBuiltin(build.items[build.index])?.rotates) return;
    build.rotation = (build.rotation + 1) % 4;
    this.updateGhost();
    this.onBuildAction?.('rotated');
  }

  /** The tile you're facing, one step ahead. */
  private frontTile(): { x: number; y: number } {
    const tx = Math.floor(this.px / TILE);
    const ty = Math.floor(this.py / TILE);
    const d = this.player.dir;
    if (d === DIR_LEFT) return { x: tx - 1, y: ty };
    if (d === DIR_RIGHT) return { x: tx + 1, y: ty };
    if (d === DIR_BACK) return { x: tx, y: ty - 1 };
    return { x: tx, y: ty + 1 };
  }

  /** Where you're aiming: the tile under the pointer, else the one you face. */
  private aimTile(): { x: number; y: number } {
    return this.pointerTile ?? this.frontTile();
  }

  /**
   * Where the piece in hand would go. Aimed with the pointer, it's centred
   * on that tile; aimed on foot, its footprint starts just in front of you.
   */
  private candidate(): TownPlacement | null {
    const build = this.build;
    if (!build) return null;
    const id = build.items[build.index];
    const def = townBuiltin(id);
    if (!id || !def) return null;
    const rotation = def.rotates ? build.rotation : 0;
    const piece = { builtin: id, ...(rotation ? { rotation } : {}) };
    const fp = townFootprint(piece);
    if (!fp) return null;
    const midW = Math.floor((fp.w - 1) / 2);
    const midH = Math.floor((fp.h - 1) / 2);
    if (this.pointerTile) {
      return { ...piece, x: this.pointerTile.x - midW, y: this.pointerTile.y - midH };
    }
    const tx = Math.floor(this.px / TILE);
    const ty = Math.floor(this.py / TILE);
    const d = this.player.dir;
    if (d === DIR_LEFT) return { ...piece, x: tx - fp.w, y: ty - midH };
    if (d === DIR_RIGHT) return { ...piece, x: tx + 1, y: ty - midH };
    if (d === DIR_BACK) return { ...piece, x: tx - midW, y: ty - fp.h };
    return { ...piece, x: tx - midW, y: ty + 1 };
  }

  /** The same rules the server applies to everyone's layouts. */
  private fits(c: TownPlacement): boolean {
    if (!this.build || this.layout.length >= TOWN_MAX_PLACEMENTS) return false;
    const next = [...this.layout, c];
    return validateTownLayout(this.build.space, next).length === next.length;
  }

  /** The topmost piece covering the tile you're aiming at. */
  private pieceAimed(): number {
    const f = this.aimTile();
    for (let i = this.layout.length - 1; i >= 0; i--) {
      const p = this.layout[i];
      if (p && covers(p, f.x, f.y)) return i;
    }
    return -1;
  }

  /** Put the piece in hand (new, or the one you're moving) down where you aim. */
  placeAtCursor(): void {
    const build = this.build;
    if (!build) return;
    const c = this.candidate();
    if (!c) return;
    if (this.layout.length >= TOWN_MAX_PLACEMENTS) {
      this.onBuildAction?.('full');
      return;
    }
    if (!this.fits(c)) {
      this.onBuildAction?.('blocked');
      return;
    }
    build.carrying = null;
    this.commitLayout([...this.layout, c]);
    this.onBuildAction?.('placed');
  }

  /** Pick up the piece you're aiming at, to move it (it rides in your hand). */
  pickUpAtCursor(): void {
    const build = this.build;
    if (!build || build.carrying) return;
    const i = this.pieceAimed();
    const piece = i >= 0 ? this.layout[i] : undefined;
    const index = piece?.builtin ? build.items.indexOf(piece.builtin as TownBuiltinId) : -1;
    if (!piece || index < 0) return;
    build.carrying = { piece, before: this.layout };
    build.index = index;
    build.rotation = piece.rotation ?? 0;
    // Shown lifted, not saved: Escape puts it back as it was.
    this.setLayoutData(this.layout.filter((_, j) => j !== i));
    this.drawLayout();
    this.updateGhost();
    this.onBuildAction?.('pickedUp');
  }

  /** Take away the piece you're carrying, or else the one you're aiming at. */
  removeAtCursor(): void {
    const build = this.build;
    if (!build) return;
    if (build.carrying) {
      build.carrying = null;
      this.commitLayout(this.layout);
      this.onBuildAction?.('removed');
      return;
    }
    const i = this.pieceAimed();
    if (i < 0) return;
    this.commitLayout(this.layout.filter((_, j) => j !== i));
    this.onBuildAction?.('removed');
  }

  /** A carried piece goes back where it was (nothing to save). */
  private putBack(): boolean {
    const carrying = this.build?.carrying;
    if (!this.build || !carrying) return false;
    this.build.carrying = null;
    this.setLayoutData(carrying.before);
    this.drawLayout();
    this.updateGhost();
    this.onBuildAction?.('putBack');
    return true;
  }

  /** Aim with the pointer (mouse or touch), in world tiles. */
  private aimAt(e: FederatedPointerEvent): void {
    const local = this.world.toLocal(e.global);
    const x = Math.floor(local.x / TILE);
    const y = Math.floor(local.y / TILE);
    if (this.pointerTile?.x === x && this.pointerTile.y === y) return;
    this.pointerTile = { x, y };
    this.updateGhost();
  }

  private onStagePointerMove = (e: FederatedPointerEvent): void => {
    if (this.build && e.pointerType === 'mouse') this.aimAt(e);
  };

  /**
   * The on-screen joystick (touch): -1..1 each way, y up. Walks like the
   * arrow keys, slower when it's only partly pushed.
   */
  setStick(x: number, y: number): void {
    this.stick = { x, y };
  }

  /**
   * Click or tap in build mode: pick up the piece there, or put down the one
   * in hand. Right-click takes the piece there away.
   */
  private onStagePointerDown = (e: FederatedPointerEvent): void => {
    if (!this.build) return;
    this.aimAt(e);
    if (e.button === 2) {
      this.removeAtCursor();
      return;
    }
    if (e.button !== 0) return;
    if (!this.build.carrying && this.pieceAimed() >= 0) this.pickUpAtCursor();
    else this.placeAtCursor();
  };

  /** The pointer left the world: aim in front of you again. */
  private onCanvasPointerLeave = (): void => {
    if (!this.pointerTile) return;
    this.pointerTile = null;
    this.updateGhost();
  };

  /** No browser menu over the world while building: right-click removes. */
  private onCanvasContextMenu = (e: MouseEvent): void => {
    if (this.build) e.preventDefault();
  };

  private commitLayout(next: TownPlacement[]): void {
    if (!this.build) return;
    const space = this.build.space;
    this.setLayoutData(next);
    this.drawLayout();
    this.ghostKey = '';
    this.updateGhost();
    this.onLayoutEdit?.(space, next);
  }

  /** Redraw the ghost (and tell the panel) when what you're aiming at changes. */
  private updateGhost(): void {
    const build = this.build;
    if (!build) return;
    const c = this.candidate();
    const aim = this.aimTile();
    // Cheap key first: the placement rules only run when something moved.
    const key = `${String(build.index)}|${String(build.rotation)}|${String(c?.x)}|${String(c?.y)}|${String(aim.x)},${String(aim.y)}|${String(this.layoutVersion)}|${String(!!build.carrying)}`;
    if (key === this.ghostKey) return;
    this.ghostKey = key;
    const aimed = this.pieceAimed();
    const ok = c ? this.fits(c) : false;

    this.buildGhost?.destroy({ children: true, context: true });
    const ghost = new Container();
    ghost.zIndex = SIGN_Z - 1;
    ghost.eventMode = 'none';
    const marks = new Graphics();
    const target = aimed >= 0 && !build.carrying ? this.layout[aimed] : undefined;
    const targetFp = target ? townFootprint(target) : null;
    if (target && targetFp) {
      marks
        .rect(
          target.x * TILE + 1,
          target.y * TILE + 1,
          targetFp.w * TILE - 2,
          targetFp.h * TILE - 2,
        )
        .stroke({ width: 2, color: REMOVE_COLOR, alpha: 0.9 });
    }
    const fp = c ? townFootprint(c) : null;
    // Aiming at a piece (and not carrying one): the outline says "this one";
    // a ghost on top of it would just be noise.
    if (c && fp && !target) {
      const color = ok ? GHOST_OK : GHOST_BAD;
      marks
        .rect(c.x * TILE, c.y * TILE, fp.w * TILE, fp.h * TILE)
        .fill({ color, alpha: 0.18 })
        .stroke({ width: 1, color, alpha: 0.85 });
      const piece = this.placementNode(c);
      if (piece) {
        piece.zIndex = 0;
        piece.alpha = ok ? 0.75 : 0.35;
        ghost.addChild(piece);
      }
    }
    ghost.addChild(marks);
    this.buildGhost = ghost;
    this.world.addChild(ghost);

    const item = build.items[build.index];
    if (!item) return;
    const view: TownBuildView = {
      space: build.space,
      items: build.items,
      item,
      canPlace: ok,
      canRotate: townBuiltin(item)?.rotates ?? false,
      canPickUp: !build.carrying && aimed >= 0,
      canRemove: !!build.carrying || aimed >= 0,
      carrying: !!build.carrying,
      full: this.layout.length >= TOWN_MAX_PLACEMENTS,
    };
    // Tell the panel only when the tray would change, not on every step.
    const last = this.lastView;
    if (
      last?.space === view.space &&
      last.item === view.item &&
      last.canPlace === view.canPlace &&
      last.canRotate === view.canRotate &&
      last.canPickUp === view.canPickUp &&
      last.canRemove === view.canRemove &&
      last.carrying === view.carrying &&
      last.full === view.full
    ) {
      return;
    }
    this.lastView = view;
    this.onBuildChange?.(view);
  }

  /** One placed piece as a display object (sheet art, or a pack sprite of its own). */
  private placementNode(p: TownPlacement): Container | null {
    const tex = p.builtin ? this.pieceTextures.get(p.builtin) : undefined;
    const def = townBuiltin(p.builtin);
    if (tex && def) {
      // Centred on its tiles; anything taller than them stands on the bottom row.
      const s = new Sprite(tex);
      s.scale.set(OBJ_SCALE);
      const w = def.w * TILE;
      const h = def.h * TILE;
      const top = Math.max(0, h - s.height) / 2;
      s.anchor.set(0.5, 1);
      const baseY = p.y * TILE + h - top;
      s.position.set(p.x * TILE + w / 2, baseY);
      // Walk-over pieces lie on the ground; the rest sort with whoever's near.
      s.zIndex = def.solid ? p.y * TILE + h - 1 : -4400;
      return s;
    }
    return drawPlacement(this.art, p);
  }

  /** Draw the scene's design (and its lamplight indoors). */
  private drawLayout(): void {
    for (const node of this.layoutNodes) node.destroy({ children: true, context: true });
    this.layoutNodes = [];
    for (const p of this.layout) {
      const node = this.placementNode(p);
      if (node) this.layoutNodes.push(node);
    }
    if (this.map.kind === 'home') {
      const glow = buildLampGlow(this.layout);
      if (glow) this.layoutNodes.push(glow);
    }
    for (const node of this.layoutNodes) this.world.addChild(node);
  }

  /**
   * Standing where a piece just appeared (the owner placed it on you): step
   * to the nearest open tile rather than being stuck inside it.
   */
  private unstick(): void {
    const sx = Math.floor(this.px / TILE);
    const sy = Math.floor(this.py / TILE);
    if (!this.isBlocked(sx, sy)) return;
    const seen = new Set<string>([`${String(sx)},${String(sy)}`]);
    const queue: Array<[number, number]> = [[sx, sy]];
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      const [x, y] = next;
      if (!this.isBlocked(x, y)) {
        this.px = x * TILE + TILE / 2;
        this.py = y * TILE + TILE / 2;
        this.player.setPosition(this.px, this.py);
        return;
      }
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ] as const) {
        const k = `${String(nx)},${String(ny)}`;
        if (seen.has(k) || nx < 0 || ny < 0 || nx >= this.map.w || ny >= this.map.h) continue;
        seen.add(k);
        queue.push([nx, ny]);
      }
    }
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
    if (this.layoutBlocked.has(`${String(tx)},${String(ty)}`)) return true;
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
    const [sheet, ...pieces] = await Promise.all([
      loadImage(OPENPIXELS_SHEET).catch(() => null),
      ...SPRITE_PIECES.map((id) => loadTexture(`${ASSET_BASE}/objects/${id}.png`)),
    ]);
    for (const t of pieces) {
      if (t) this.ownedTextures.push(t);
    }
    if (sheet) {
      const base = Texture.from(sheet);
      base.source.scaleMode = 'nearest';
      this.ownedTextures.push(base);
      this.art = new OpenPixels(base, sheet);
    }
    SPRITE_PIECES.forEach((id, i) => {
      const t = pieces[i];
      if (t) this.pieceTextures.set(id, t);
    });
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
    this.drawLayout();
    this.onSignHover?.(null, 0, 0);
    const art = this.art;
    const map = this.map;

    if (art && map.outdoors) {
      const ground = art.tiled('grass', 0, 0, map.w, map.h);
      ground.zIndex = -10000;
      this.addSceneNode(ground);
    }

    if (art) {
      for (const piece of buildStructures(art, map.kind, this.openSlots, this.hasMoreGates)) {
        this.addSceneNode(piece);
      }
    }
    this.windowGlow = null;
    if (map.kind === 'neighborhood') {
      this.windowGlow = buildWindowGlow();
      this.windowGlow.visible = this.windowLit;
      this.addSceneNode(this.windowGlow);
    }
    this.buildSignLabels();

    for (const o of art ? map.objects : []) {
      if (!art) break;
      if (o.type === 'pond') {
        // The yard's water feature: the sheet's stone well, centred on its tiles.
        const s = art.sprite('well', 0, 0);
        s.position.set((o.tx + 1.5) * TILE - s.width / 2, (o.ty + 2) * TILE - s.height);
        s.zIndex = (o.ty + 2) * TILE - 1;
        this.addSceneNode(s);
      } else {
        // The forest edge: trees standing on their tile, crowns spilling over.
        const s = art.sprite('tree', 0, 0);
        s.position.set((o.tx + 0.5) * TILE - s.width / 2, (o.ty + 1) * TILE - s.height + 6);
        s.zIndex = (o.ty + 1) * TILE - 1;
        this.addSceneNode(s);
      }
    }

    this.player.setPosition(this.px, this.py);
    if (!enter) return;
    this.unstick();
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
    let borrowed = false;
    try {
      img = await loadImage(spriteUrl(did));
    } catch {
      borrowed = true;
      img = await loadImage(spriteUrl(GAME_MASTER_DID)).catch(() => null);
    }
    if (did === this.selfDid && avatar === this.player) {
      // Only a confirmed "no sprite" (404) — not a network blip or outage.
      const missing = borrowed && (await spriteMissing(did));
      if (!this.destroyed) this.onOwnSprite?.(missing);
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
    this.peers.set(p.did, {
      avatar,
      x: p.x,
      y: p.y,
      tx: p.x,
      ty: p.y,
      pace: p.sprint ? SPRINT : 1,
    });
    void this.dressAvatar(avatar, p.did);
  }

  peerMove(p: TownPeer): void {
    const peer = this.peers.get(p.did);
    if (!peer) {
      this.peerJoin(p);
      return;
    }
    peer.pace = p.sprint ? SPRINT : 1;
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
    if (!this.inputEnabled) return;
    if (this.onBuildKey(e)) return;
    if (e.key === SPRINT_KEY) {
      // Leave Space to a field or a keyboard-focused control; otherwise it's
      // the run key (and shouldn't scroll the page or click a stray button).
      if (spaceBelongsToFocus(e.target)) return;
      this.keys.add(e.key);
      e.preventDefault();
      return;
    }
    // Typing in any field (a DM, the buddy search) never walks you around.
    if (!MOVE_KEYS.has(e.key) || isTextEntry(e.target)) return;
    this.keys.add(e.key);
    e.preventDefault();
  };

  /** Build mode's keys; true when the key was one of them. */
  private onBuildKey(e: KeyboardEvent): boolean {
    if (isTextEntry(e.target) || e.metaKey || e.ctrlKey || e.altKey) return false;
    if (!buildKeysApply(e.target)) return false;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === BUILD_KEY && !e.repeat && this.buildable) {
      if (this.build) this.endBuild();
      else this.onBuildRequest?.();
      e.preventDefault();
      return true;
    }
    if (!this.build) return false;
    // A control the keyboard focused keeps its own Enter; one you clicked
    // with the mouse doesn't (same rule as Space).
    const onControl = spaceBelongsToFocus(e.target);
    switch (key) {
      case 'Escape':
        // Carrying a piece: put it back. Otherwise: done designing.
        if (!this.putBack()) this.endBuild();
        break;
      case ROTATE_KEY:
        this.rotateBuildItem();
        break;
      case PICK_UP_KEY:
        if (!e.repeat) this.pickUpAtCursor();
        break;
      case '[':
        this.cycleBuildItem(-1);
        break;
      case ']':
        this.cycleBuildItem(1);
        break;
      case 'Enter':
        if (onControl) return false;
        if (!e.repeat) this.placeAtCursor();
        break;
      case 'Delete':
      case 'Backspace':
        if (!e.repeat) this.removeAtCursor();
        break;
      default:
        return false;
    }
    e.preventDefault();
    return true;
  }

  /** Switching windows mid-stride: keyups never arrive, so let go of everything. */
  private onBlur = (): void => {
    this.keys.clear();
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

    // Keys win; otherwise the joystick, at the speed it's pushed to.
    let throttle = 1;
    if (dx === 0 && dy === 0 && (this.stick.x !== 0 || this.stick.y !== 0)) {
      dx = this.stick.x;
      dy = -this.stick.y;
      throttle = Math.min(1, Math.hypot(dx, dy));
    }
    const moving = !this.atDoor && (dx !== 0 || dy !== 0);
    if (moving) {
      if (Math.abs(dx) > Math.abs(dy)) this.player.dir = dx < 0 ? DIR_LEFT : DIR_RIGHT;
      else this.player.dir = dy < 0 ? DIR_BACK : DIR_FORWARD;

      const len = Math.hypot(dx, dy) || 1;
      const sprinting = this.keys.has(SPRINT_KEY);
      const step = ((sprinting ? SPEED * SPRINT : SPEED) * throttle * dt) / len;
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
    this.player.tick(dtMs, moving, moving && this.keys.has(SPRINT_KEY) ? SPRINT : 1);
    this.player.setPosition(this.px, this.py);
    this.checkDoorway();
    // Walking aims in front of you again (until the mouse moves).
    if (moving && this.pointerTile) {
      this.pointerTile = null;
      this.ghostKey = '';
    }
    this.updateGhost();

    // Throttled position broadcast (sends the resting position too, since the
    // changed-check stays true until the latest pose is acknowledged).
    this.sendAccumMs += dtMs;
    // Running only counts while actually moving.
    const sprinting = moving && this.keys.has(SPRINT_KEY);
    const changed =
      this.px !== this.sentX ||
      this.py !== this.sentY ||
      this.player.dir !== this.sentDir ||
      sprinting !== this.sentSprint;
    if (changed && this.sendAccumMs >= MOVE_SEND_MS) {
      this.sendAccumMs = 0;
      this.sentX = this.px;
      this.sentY = this.py;
      this.sentDir = this.player.dir;
      this.sentSprint = sprinting;
      // Whole pixels: sub-pixel jitter isn't worth a network message.
      this.onMove?.(Math.round(this.px), Math.round(this.py), this.player.dir, sprinting);
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
      peer.avatar.tick(dtMs, peerMoving, peer.pace);
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
    this.onBuildChange = undefined;
    this.endBuild();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    if (this.ready) {
      this.app.canvas.removeEventListener('pointerleave', this.onCanvasPointerLeave);
      this.app.canvas.removeEventListener('contextmenu', this.onCanvasContextMenu);
    }
    if (this.ready) this.app.ticker.remove(this.tick);
    // Free GPU memory — these base textures are shared by frame sub-textures
    // and are not released by app.destroy({ texture: false }). Before the
    // app: destroying a texture source notifies the renderer's GC, which
    // app.destroy nulls ("Cannot read properties of null (reading 'gc')").
    this.art?.destroy();
    this.art = null;
    for (const t of this.frameTextures) t.destroy();
    this.frameTextures = [];
    for (const t of this.ownedTextures) t.destroy(true);
    this.ownedTextures = [];
    this.fallbackTex?.destroy(true);
    this.fallbackTex = null;
    if (this.ready) {
      this.app.destroy({ removeView: true }, { children: true, texture: false });
    }
  }
}

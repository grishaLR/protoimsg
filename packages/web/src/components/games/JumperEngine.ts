import type { Agent } from '@atproto/api';
import { authFetch } from '../../lib/api';

const CW = 352;
const CH = 520;
const PLAT_H = 10;
const GRAVITY = 0.25;
const BOUNCE_V = -10.5;
const WALK_SPEED = 3.5;
const MAX_GAP = 170;
const SPRING_V = BOUNCE_V * 2;
const JETPACK_DURATION = 210;
const BH_RADIUS = 20;
const BH_PULL_RADIUS = 100;

type PlatType = 'solid' | 'crumble' | 'moving';
export type JumperDifficulty = 'fast' | 'faster';

interface Plat {
  x: number;
  y: number;
  w: number;
  type: PlatType;
  dx: number;
  crumbleTimer: number;
  hasSpring: boolean;
}
interface BlackHole {
  x: number;
  y: number;
  angle: number;
}
interface Alien {
  x: number;
  y: number;
  dx: number;
  baseY: number;
  phase: number;
  amplitude: number;
  dyingTimer: number;
}

export interface SpriteRecord {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  width: number;
  height: number;
  spriteSheet: { ref: { $link: string } };
}

export interface JumperDeathInfo {
  score: number;
  hi: number;
  rank: number | null;
  cause: 'fall' | 'alien' | 'blackhole';
  result: 'leaderboard' | 'best' | 'lose';
}

function makePlat(x: number, y: number, w: number, type: PlatType, hasSpring = false): Plat {
  return {
    x,
    y,
    w,
    type,
    hasSpring,
    dx: type === 'moving' ? (Math.random() > 0.5 ? 1 : -1) * (0.7 + Math.random() * 0.9) : 0,
    crumbleTimer: -1,
  };
}

function generatePlatforms(topY: number, bottomY: number, scrolled: number): Plat[] {
  const plats: Plat[] = [];
  const diff = Math.min(2, scrolled / 2000);
  let y = bottomY;
  let prevType: PlatType = 'solid';
  while (y > topY) {
    const w = Math.max(30, 68 - diff * 18 + Math.random() * 14);
    const x = 8 + Math.random() * (CW - w - 16);
    const r = Math.random();
    let type: PlatType = 'solid';
    if (prevType === 'solid') {
      if (diff > 0.4 && r > 0.82) type = 'crumble';
      else if (diff > 0.7 && r > 0.74) type = 'moving';
    }
    const hasSpring = type === 'solid' && Math.random() < 0.07;
    plats.push(makePlat(x, y, w, type, hasSpring));
    prevType = type;
    y -= Math.min(MAX_GAP, 95 + diff * 55 + Math.random() * 25);
  }
  return plats;
}

async function writeJumperStats(agent: Agent, viewerDid: string, score: number, system: string) {
  try {
    const idx = system.indexOf('_');
    const base = idx === -1 ? system : system.slice(0, idx);
    const difficulty = idx === -1 ? 'default' : system.slice(idx + 1);
    const statsRes = await agent.com.atproto.repo
      .getRecord({ repo: viewerDid, collection: 'actor.rpg.stats', rkey: 'self' })
      .catch(() => null);
    const existingStats: Record<string, unknown> = statsRes
      ? (statsRes.data.value as Record<string, unknown>)
      : {};
    const existingGame = existingStats[base] as Record<string, unknown> | undefined;
    const prev = existingGame?.[difficulty] as
      | { best?: number; tries?: number; worst?: number }
      | undefined;
    const now = new Date().toISOString();
    await agent.com.atproto.repo.putRecord({
      repo: viewerDid,
      collection: 'actor.rpg.stats',
      rkey: 'self',
      record: {
        ...existingStats,
        $type: 'actor.rpg.stats',
        [base]: {
          ...(existingGame ?? {}),
          _meta: { name: `proto IM ${base}` },
          [difficulty]: {
            best: Math.max(score, prev?.best ?? 0),
            tries: (prev?.tries ?? 0) + 1,
            worst: prev ? Math.min(score, prev.worst ?? score) : score,
          },
        },
        updatedAt: now,
        ...(existingStats.createdAt ? {} : { createdAt: now }),
      },
    });
  } catch {
    /* silently fail */
  }
}

export class JumperEngine {
  // Updated by React wrapper between frames
  agent: Agent | null = null;
  viewerDid: string | null = null;
  leaderboard: { did: string; score: number }[] = [];

  onDeath?: (info: JumperDeathInfo) => void;
  onScore?: (score: number, difficulty: JumperDifficulty) => void;
  onClose?: () => void;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private difficulty: JumperDifficulty;
  private practiceMode: boolean;
  private system: string;

  // Per-difficulty physics
  private GRAV: number;
  private BNCE: number;
  private WALK: number;
  private SPRNG: number;
  private JPACK: number;
  private initAlienAt: number;
  private initBlackHoleAt: number;

  // Sprite
  private sprite: SpriteRecord | null = null;
  private img: HTMLImageElement | null = null;
  private jetpackImg: HTMLImageElement | null = null;
  private alienImg: HTMLImageElement | null = null;
  private springImg: HTMLImageElement | null = null;
  private FW = 16;
  private FH = 16;
  private COLS = 3;

  // Audio
  private sfxJetpack: HTMLAudioElement;
  private sfxAlien: HTMLAudioElement;
  private sfxAlienProximity: HTMLAudioElement;
  private sfxBlackHole: HTMLAudioElement;
  private sfxLose: HTMLAudioElement;
  private sfxWin: HTMLAudioElement;
  private sfxAchievement: HTMLAudioElement;
  private sfxAmbience: HTMLAudioElement;
  private sfxBoing: HTMLAudioElement;
  private sfxLand: HTMLAudioElement;
  private sfxEnemyDeath: HTMLAudioElement;
  private sfxStart: HTMLAudioElement;

  private st!: {
    px: number;
    py: number;
    pvx: number;
    pvy: number;
    plats: Plat[];
    aliens: Alien[];
    nextAlienAt: number;
    blackHoles: BlackHole[];
    nextBlackHoleAt: number;
    jetpackPickup: { x: number; y: number } | null;
    nextJetpackAt: number;
    jetpackFrames: number;
    scrolled: number;
    score: number;
    dead: boolean;
    deadFrames: number;
    deathCause: 'fall' | 'alien' | 'blackhole';
    deathResult: 'leaderboard' | 'best' | 'lose';
    suckedIn: boolean;
    suckTimer: number;
    suckBhX: number;
    suckBhY: number;
    deadDelay: number;
    started: boolean;
    animFrame: number;
    tick: number;
    facing: 1 | -1;
    touchLeft: boolean;
    touchRight: boolean;
    hi: number;
    prevHi: number;
  };

  private keys = { left: false, right: false };
  private raf = 0;
  private lastFrameTime = 0;
  private readonly FRAME_MS = 1000 / 60;
  private scoreWritten = false;
  private deathReported = false;
  private stars: { x: number; y: number; size: number; brightness: number }[];

  constructor(
    canvas: HTMLCanvasElement,
    config: { difficulty: JumperDifficulty; practiceMode?: boolean },
  ) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
    this.difficulty = config.difficulty;
    this.practiceMode = config.practiceMode ?? false;
    this.system = `jumper_${config.difficulty}`;

    this.GRAV = config.difficulty === 'faster' ? 0.38 : GRAVITY;
    this.BNCE = config.difficulty === 'faster' ? -13.5 : BOUNCE_V;
    this.WALK = config.difficulty === 'faster' ? 5.0 : WALK_SPEED;
    this.SPRNG = config.difficulty === 'faster' ? this.BNCE * 1.8 : SPRING_V;
    this.JPACK = config.difficulty === 'faster' ? -5.0 : -3.5;
    this.initAlienAt = config.difficulty === 'faster' ? 1200 : 2000;
    this.initBlackHoleAt = config.difficulty === 'faster' ? 5000 : 8000;

    this.stars = Array.from({ length: 60 }, () => ({
      x: Math.random() * CW,
      y: Math.random() * CH,
      size: Math.random() > 0.85 ? 2 : 1,
      brightness: 0.3 + Math.random() * 0.7,
    }));

    const muted = localStorage.getItem('protoimsg:sfx-muted') === 'true';
    const a = (src: string, opts?: { loop?: boolean; vol?: number }) => {
      const el = new Audio(src);
      el.preload = 'auto';
      if (opts?.loop) el.loop = true;
      if (opts?.vol !== undefined) el.volume = opts.vol;
      if (muted) el.muted = true;
      return el;
    };
    this.sfxJetpack = a('/assets/games/sfx/WarpDrive_01.mp3');
    this.sfxAlien = a('/assets/games/sfx/Robot_Talk_02.mp3');
    this.sfxAlienProximity = a('/assets/games/sfx/SpaceShip_Engine_Small_Loop_00.mp3', {
      loop: true,
      vol: 0,
    });
    this.sfxBlackHole = a('/assets/games/sfx/Ambience_BlackHole_00.mp3', { loop: true, vol: 0 });
    this.sfxLose = a('/assets/games/sfx/Jingle_Lose_00.mp3');
    this.sfxWin = a('/assets/games/sfx/Jingle_Win_00.mp3');
    this.sfxAchievement = a('/assets/games/sfx/Jingle_Achievement_00.mp3');
    this.sfxAmbience = a('/assets/games/sfx/Ambience_Space_00.mp3', { loop: true, vol: 0.35 });
    this.sfxBoing = a('/assets/games/sfx/boing.mp3');
    this.sfxLand = a('/assets/games/sfx/SoundBlowDull.mp3');
    this.sfxEnemyDeath = a('/assets/games/sfx/SoundEnemyDeath.mp3');
    this.sfxStart = a('/assets/games/sfx/SoundStartLevel.mp3');
    if (!muted) void this.sfxAmbience.play().catch(() => {});

    const loadImg = (src: string, cb: (img: HTMLImageElement) => void) => {
      const img = new Image();
      img.src = src;
      img.onload = () => {
        cb(img);
      };
    };
    loadImg('/assets/games/kenney-alien-ufo/PNG/shipGreen_manned.png', (img) => {
      this.alienImg = img;
    });
    loadImg('/assets/games/spring.png', (img) => {
      this.springImg = img;
    });

    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    canvas.addEventListener('touchstart', this.onTouch, { passive: false });
    canvas.addEventListener('touchmove', this.onTouch, { passive: false });
    canvas.addEventListener('touchend', this.onTouchEnd);

    this.initState();
    this.fetchHiScore();
    this.raf = requestAnimationFrame(this.loop);
  }

  private initPlats(): Plat[] {
    const plats: Plat[] = [];
    plats.push(makePlat(CW / 2 - 32, CH - 44, 64, 'solid'));
    let y = CH - 44 - 100;
    while (y > CH * 0.1) {
      const w = 44 + Math.random() * 16;
      const x = 8 + Math.random() * (CW - w - 16);
      plats.push(makePlat(x, y, w, 'solid'));
      y -= 95 + Math.random() * 35;
    }
    return plats;
  }

  private initState(): void {
    this.st = {
      px: CW / 2,
      py: CH - 44 - this.FH,
      pvx: 0,
      pvy: this.BNCE,
      plats: this.initPlats(),
      aliens: [],
      nextAlienAt: this.initAlienAt,
      blackHoles: [],
      nextBlackHoleAt: this.initBlackHoleAt,
      jetpackPickup: null,
      nextJetpackAt: 5000,
      jetpackFrames: 0,
      scrolled: 0,
      score: 0,
      dead: false,
      deadFrames: 0,
      deathCause: 'fall',
      deathResult: 'lose',
      suckedIn: false,
      suckTimer: 0,
      suckBhX: 0,
      suckBhY: 0,
      deadDelay: 0,
      started: false,
      animFrame: 0,
      tick: 0,
      facing: 1,
      touchLeft: false,
      touchRight: false,
      hi: 0,
      prevHi: 0,
    };
  }

  private fetchHiScore(): void {
    const st = this.st;
    if (!this.practiceMode && this.agent && this.viewerDid) {
      this.agent.com.atproto.repo
        .getRecord({ repo: this.viewerDid, collection: 'actor.rpg.stats', rkey: 'self' })
        .then((res) => {
          const gd = (res.data.value as Record<string, unknown> | undefined)?.jumper as
            | Record<string, unknown>
            | undefined;
          const dd = gd?.[this.difficulty] as { best?: number } | undefined;
          st.hi = dd?.best ?? 0;
          st.prevHi = st.hi;
        })
        .catch(() => {});
    } else {
      const v = parseInt(
        localStorage.getItem(`protoimsg:practice:jumper_${this.difficulty}:best`) ?? '0',
        10,
      );
      st.hi = v;
      st.prevHi = v;
    }
  }

  updateActor(sprite: SpriteRecord | null, img: HTMLImageElement | null): void {
    this.sprite = sprite;
    this.img = img;
    this.FW = Math.round(sprite?.frameWidth ?? 16);
    this.FH = Math.round(sprite?.frameHeight ?? 16);
    this.COLS = sprite?.columns ?? 3;
    // Reposition player on starting platform if the game hasn't launched yet
    if (!this.st.started && !this.st.dead) {
      this.st.py = CH - 44 - this.FH;
    }
  }

  updateJetpackImg(img: HTMLImageElement | null): void {
    this.jetpackImg = img;
  }

  updateLeaderboard(entries: { did: string; score: number }[]): void {
    this.leaderboard = entries;
  }

  updateAuth(agent: Agent | null, viewerDid: string | null): void {
    this.agent = agent;
    this.viewerDid = viewerDid;
  }

  setSfxMuted(muted: boolean): void {
    localStorage.setItem('protoimsg:sfx-muted', String(muted));
    const all = [
      this.sfxJetpack,
      this.sfxAlien,
      this.sfxAlienProximity,
      this.sfxBlackHole,
      this.sfxLose,
      this.sfxWin,
      this.sfxAchievement,
      this.sfxBoing,
      this.sfxLand,
      this.sfxEnemyDeath,
      this.sfxStart,
      this.sfxAmbience,
    ];
    for (const el of all) el.muted = muted;
    if (muted) this.sfxAmbience.pause();
    else void this.sfxAmbience.play().catch(() => {});
  }

  startGame(): void {
    this.st.started = true;
    this.sfxStart.currentTime = 0;
    void this.sfxStart.play().catch(() => {});
  }

  restart(): void {
    this.reset();
    this.startGame();
  }

  private reset(): void {
    this.deathReported = false;
    this.scoreWritten = false;
    const st = this.st;
    st.plats = this.initPlats();
    st.aliens = [];
    st.nextAlienAt = this.initAlienAt;
    st.blackHoles = [];
    st.nextBlackHoleAt = this.initBlackHoleAt;
    this.sfxBlackHole.volume = 0;
    this.sfxBlackHole.pause();
    this.sfxAlienProximity.volume = 0;
    this.sfxAlienProximity.pause();
    for (const el of [this.sfxLose, this.sfxWin, this.sfxAchievement]) {
      el.pause();
      el.currentTime = 0;
    }
    Object.assign(st, {
      jetpackPickup: null,
      nextJetpackAt: 5000,
      jetpackFrames: 0,
      px: CW / 2,
      py: CH - 44 - this.FH,
      pvx: 0,
      pvy: this.BNCE,
      scrolled: 0,
      score: 0,
      dead: false,
      deadFrames: 0,
      deathCause: 'fall',
      deathResult: 'lose',
      suckedIn: false,
      suckTimer: 0,
      deadDelay: 0,
      prevHi: st.hi,
      started: false,
      animFrame: 0,
      tick: 0,
      facing: 1,
    });
  }

  private playDeathJingle(): void {
    const st = this.st;
    const entries = this.leaderboard;
    const isNewBest = st.score > 0 && st.score > st.prevHi;
    const canPost = !this.practiceMode && !!(this.agent && this.viewerDid);
    const wouldQualify = entries.length < 5 || st.score > (entries.at(-1)?.score ?? 0);
    const onBoard = canPost && isNewBest && wouldQualify;
    st.deathResult = onBoard ? 'leaderboard' : isNewBest ? 'best' : 'lose';
    if (onBoard) {
      this.sfxWin.currentTime = 0;
      void this.sfxWin.play().catch(() => {});
    } else if (isNewBest) {
      this.sfxAchievement.currentTime = 0;
      void this.sfxAchievement.play().catch(() => {});
    } else {
      this.sfxLose.currentTime = 0;
      void this.sfxLose.play().catch(() => {});
    }
  }

  private writeScore(): void {
    if (this.scoreWritten) return;
    this.scoreWritten = true;
    const st = this.st;
    this.onScore?.(st.score, this.difficulty);
    if (!this.practiceMode && this.agent && this.viewerDid) {
      void writeJumperStats(this.agent, this.viewerDid, st.score, this.system);
      void authFetch('/api/games/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: this.system, score: st.score }),
      });
    } else {
      const lsKey = `protoimsg:practice:jumper_${this.difficulty}:best`;
      if (st.score > st.prevHi) localStorage.setItem(lsKey, String(st.score));
    }
  }

  private onKey = (e: KeyboardEvent) => {
    const down = e.type === 'keydown';
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
      if (this.st.started && !this.st.dead) {
        this.keys.left = down;
        e.preventDefault();
      }
    }
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      if (this.st.started && !this.st.dead) {
        this.keys.right = down;
        e.preventDefault();
      }
    }
    if (e.key === 'Escape') this.onClose?.();
  };

  private onTouch = (e: TouchEvent) => {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    this.st.touchLeft = false;
    this.st.touchRight = false;
    for (let i = 0; i < e.touches.length; i++) {
      const tx = (e.touches[i]?.clientX ?? 0) - rect.left;
      if (tx < CW / 2) this.st.touchLeft = true;
      else this.st.touchRight = true;
    }
  };

  private onTouchEnd = () => {
    this.st.touchLeft = false;
    this.st.touchRight = false;
  };

  private drawBg(): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#06000f';
    ctx.fillRect(0, 0, CW, CH);
    for (const s of this.stars) {
      ctx.globalAlpha = s.brightness;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(s.x, s.y, s.size, s.size);
    }
    ctx.globalAlpha = 1;
  }

  private drawPlat(p: Plat): void {
    const ctx = this.ctx;
    const { x, y, w } = p;
    if (p.crumbleTimer < -1) {
      const nearReturn = p.crumbleTimer > -35;
      ctx.globalAlpha = nearReturn && Math.floor(-p.crumbleTimer / 4) % 2 === 0 ? 0.65 : 0.18;
      ctx.fillStyle = '#f97316';
      ctx.fillRect(x, y, w, PLAT_H);
      ctx.globalAlpha = 1;
      return;
    }
    let top: string, mid: string, bot: string;
    if (p.type === 'crumble') {
      const flash = p.crumbleTimer > 0 && Math.floor(p.crumbleTimer / 4) % 2 === 0;
      top = flash ? '#fbbf24' : '#f97316';
      mid = flash ? '#d97706' : '#c2410c';
      bot = '#7c2d12';
    } else if (p.type === 'moving') {
      top = '#67e8f9';
      mid = '#0891b2';
      bot = '#164e63';
    } else {
      top = '#4ade80';
      mid = '#16a34a';
      bot = '#14532d';
    }
    ctx.fillStyle = mid;
    ctx.fillRect(x, y, w, PLAT_H);
    ctx.fillStyle = top;
    ctx.fillRect(x, y, w, 3);
    ctx.fillStyle = bot;
    ctx.fillRect(x, y + PLAT_H - 2, w, 2);
    ctx.fillStyle = bot;
    ctx.fillRect(x, y, 2, 2);
    ctx.fillRect(x + w - 2, y, 2, 2);
    if (p.type === 'moving') {
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.5;
      ctx.fillRect(p.dx > 0 ? x + w - 8 : x + 4, y + 3, 4, 4);
      ctx.globalAlpha = 1;
    }
    if (p.type === 'crumble' && p.crumbleTimer < 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x + Math.floor(w * 0.3), y + 2, 1, 5);
      ctx.fillRect(x + Math.floor(w * 0.65), y + 1, 1, 4);
    }
    if (p.hasSpring) {
      const sImg = this.springImg;
      const sw = 18,
        sh = 22;
      const sx = Math.floor(x + w / 2 - sw / 2);
      if (sImg) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(sImg, 0, 0, 276, 324, sx, y - sh, sw, sh);
      } else {
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(sx, y - sh, sw, sh);
      }
    }
  }

  private drawPlayer(px: number, py: number, facing: 1 | -1): void {
    const ctx = this.ctx;
    const { img, sprite, FW, FH, st } = this;
    if (img && sprite) {
      ctx.imageSmoothingEnabled = false;
      ctx.save();
      if (facing === -1) {
        ctx.translate(px + FW, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(
          img,
          st.animFrame * sprite.frameWidth,
          2 * sprite.frameHeight,
          sprite.frameWidth,
          sprite.frameHeight,
          0,
          py,
          FW,
          FH,
        );
      } else {
        ctx.drawImage(
          img,
          st.animFrame * sprite.frameWidth,
          2 * sprite.frameHeight,
          sprite.frameWidth,
          sprite.frameHeight,
          px,
          py,
          FW,
          FH,
        );
      }
      ctx.restore();
    } else {
      ctx.fillStyle = '#7c3aed';
      ctx.fillRect(px + 4, py + Math.round(FH * 0.45), FW - 8, Math.round(FH * 0.55));
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(px + 4, py, FW - 8, Math.round(FH * 0.45));
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(px + 6, py + 5, 3, 3);
      ctx.fillRect(px + FW - 10, py + 5, 3, 3);
    }
  }

  private drawAlien(al: Alien): void {
    const ctx = this.ctx;
    const img = this.alienImg;
    const AW = 48,
      AH = 48;
    const ax = Math.round(al.x),
      ay = Math.round(al.y);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.save();
    if (al.dyingTimer > 0) {
      const t = al.dyingTimer / 22;
      ctx.globalAlpha = t;
      if (img)
        ctx.drawImage(img, ax, ay + AH - Math.round(AH * t * 0.5), AW, Math.round(AH * t * 0.5));
    } else if (img) {
      if (al.dx < 0) {
        ctx.translate(ax + AW, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, ay, AW, AH);
      } else ctx.drawImage(img, ax, ay, AW, AH);
    } else {
      ctx.fillStyle = '#c084fc';
      ctx.fillRect(ax + 2, ay + 5, 16, 10);
      ctx.fillRect(ax + 5, ay + 1, 10, 6);
    }
    ctx.restore();
  }

  private drawJetpackPickup(x: number, y: number): void {
    const ctx = this.ctx;
    const pulse = 0.25 + Math.sin(Date.now() / 250) * 0.15;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#f97316';
    ctx.fillRect(x - 4, y - 4, 36, 36);
    ctx.globalAlpha = 1;
    const img = this.jetpackImg;
    if (img) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, x, y, 28, 28);
    } else {
      ctx.fillStyle = '#ec4899';
      ctx.fillRect(x + 4, y + 2, 20, 24);
      ctx.fillStyle = '#f97316';
      ctx.fillRect(x + 8, y + 22, 4, 6);
      ctx.fillRect(x + 16, y + 22, 4, 6);
    }
  }

  private drawBlackHole(bh: BlackHole): void {
    const ctx = this.ctx;
    const { x, y } = bh;
    const og = ctx.createRadialGradient(x, y, BH_RADIUS, x, y, BH_PULL_RADIUS * 0.7);
    og.addColorStop(0, 'rgba(139,92,246,0.35)');
    og.addColorStop(0.5, 'rgba(59,7,100,0.15)');
    og.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = og;
    ctx.beginPath();
    ctx.arc(x, y, BH_PULL_RADIUS * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(bh.angle);
    ctx.scale(1, 0.28);
    ctx.beginPath();
    ctx.arc(0, 0, BH_RADIUS + 14, 0, Math.PI * 2);
    const dg = ctx.createRadialGradient(0, 0, BH_RADIUS, 0, 0, BH_RADIUS + 14);
    dg.addColorStop(0, '#f97316');
    dg.addColorStop(0.4, '#c084fc');
    dg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.strokeStyle = dg;
    ctx.lineWidth = 10;
    ctx.stroke();
    ctx.restore();
    const cg = ctx.createRadialGradient(x - 4, y - 4, 2, x, y, BH_RADIUS);
    cg.addColorStop(0, '#1e1b4b');
    cg.addColorStop(1, '#000000');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(x, y, BH_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#a78bfa';
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(x, y, BH_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawHud(): void {
    const ctx = this.ctx;
    const { st } = this;
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(CW - 80, 6, 76, 30);
    ctx.fillStyle = '#4ade80';
    ctx.fillText(`${st.score}`, CW - 8, 20);
    ctx.fillStyle = '#64748b';
    ctx.font = '10px monospace';
    ctx.fillText(`BEST ${st.hi}`, CW - 8, 32);
  }

  private loop = (now: number) => {
    if (now - this.lastFrameTime < this.FRAME_MS - 1) {
      this.raf = requestAnimationFrame(this.loop);
      return;
    }
    this.lastFrameTime = now;
    this.step();
    this.raf = requestAnimationFrame(this.loop);
  };

  private step(): void {
    const ctx = this.ctx;
    const st = this.st;
    const { FW, FH } = this;

    this.drawBg();

    if (!st.started) {
      for (const p of st.plats) this.drawPlat(p);
      this.drawPlayer(st.px - FW / 2, st.py, st.facing);
      return;
    }

    if (st.suckedIn) {
      for (const p of st.plats) this.drawPlat(p);
      if (st.deathCause === 'blackhole') for (const bh of st.blackHoles) this.drawBlackHole(bh);
      if (st.deathCause === 'alien') for (const al of st.aliens) this.drawAlien(al);
      const t = 1 - st.suckTimer / 70;
      const ease = t * t;
      const cx = st.px + (st.suckBhX - st.px) * ease;
      const cy = st.py + FH / 2 + (st.suckBhY - (st.py + FH / 2)) * ease;
      ctx.save();
      ctx.translate(Math.round(cx), Math.round(cy));
      ctx.rotate(t * Math.PI * 8);
      ctx.scale(Math.max(0, 1 - ease), Math.max(0, 1 - ease));
      const { img, sprite } = this;
      if (img && sprite) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
          img,
          st.animFrame * sprite.frameWidth,
          2 * sprite.frameHeight,
          sprite.frameWidth,
          sprite.frameHeight,
          -FW / 2,
          -FH / 2,
          FW,
          FH,
        );
      } else {
        ctx.fillStyle = '#7c3aed';
        ctx.fillRect(-FW / 2 + 4, Math.round(-FH * 0.05), FW - 8, Math.round(FH * 0.55));
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(-FW / 2 + 4, -FH / 2, FW - 8, Math.round(FH * 0.45));
      }
      ctx.restore();
      st.suckTimer--;
      if (st.suckTimer <= 0) {
        st.suckedIn = false;
        st.deadDelay = 50;
        if (st.deathCause === 'alien' && !this.sfxAlien.paused) {
          this.sfxAlien.addEventListener(
            'ended',
            () => {
              this.playDeathJingle();
            },
            { once: true },
          );
        } else {
          this.playDeathJingle();
        }
      }
      return;
    }

    if (st.deadDelay > 0) {
      st.deadDelay--;
      if (st.deadDelay === 0) st.dead = true;
      for (const p of st.plats) this.drawPlat(p);
      if (st.deathCause === 'blackhole') for (const bh of st.blackHoles) this.drawBlackHole(bh);
      if (st.deathCause === 'alien') for (const al of st.aliens) this.drawAlien(al);
      return;
    }

    if (st.dead) {
      st.deadFrames++;
      for (const p of st.plats) this.drawPlat(p);
      if (!this.deathReported) {
        this.deathReported = true;
        const board = this.leaderboard;
        const rank = board.length > 0 ? board.filter((e) => e.score > st.score).length + 1 : null;
        this.onDeath?.({
          score: st.score,
          hi: st.hi,
          rank,
          cause: st.deathCause,
          result: st.deathResult,
        });
      }
      return;
    }

    // ── Physics ──────────────────────────────────────────────────────────────
    const goLeft = this.keys.left || st.touchLeft;
    const goRight = this.keys.right || st.touchRight;
    if (goLeft) {
      st.pvx = -this.WALK;
      st.facing = -1;
    } else if (goRight) {
      st.pvx = this.WALK;
      st.facing = 1;
    } else st.pvx *= 0.8;

    st.px += st.pvx;
    if (st.px < -FW / 2) st.px = CW + FW / 2;
    if (st.px > CW + FW / 2) st.px = -FW / 2;

    if (st.jetpackFrames > 0) {
      st.pvy = this.JPACK;
    } else {
      st.pvy += this.GRAV;
      if (st.pvy > 18) st.pvy = 18;
    }
    st.py += st.pvy;

    const playerBottom = st.py + FH;
    const playerLeft = st.px - FW * 0.28;
    const playerRight = st.px + FW * 0.28;

    if (st.pvy > 0 && st.jetpackFrames === 0) {
      for (const p of st.plats) {
        if (p.crumbleTimer > 0 || p.crumbleTimer < -1) continue;
        const prevBottom = playerBottom - st.pvy;
        if (
          playerRight > p.x &&
          playerLeft < p.x + p.w &&
          prevBottom <= p.y &&
          playerBottom >= p.y
        ) {
          if (p.type === 'crumble') {
            p.crumbleTimer = 40;
            st.pvy = this.BNCE;
            st.py = p.y - FH;
            this.sfxLand.currentTime = 0;
            void this.sfxLand.play().catch(() => {});
          } else {
            const boost = p.hasSpring ? this.SPRNG : this.BNCE;
            st.pvy = boost;
            st.py = p.y - FH;
            if (p.hasSpring) {
              this.sfxBoing.currentTime = 0;
              void this.sfxBoing.play().catch(() => {});
            } else {
              this.sfxLand.currentTime = 0;
              void this.sfxLand.play().catch(() => {});
            }
          }
          break;
        }
      }
    }

    // Alien movement
    const alienDiff = Math.min(2, st.scrolled / 2000);
    for (const al of st.aliens) {
      if (al.dyingTimer > 0) {
        al.dyingTimer--;
        if (al.dyingTimer === 0) al.dyingTimer = -1;
        continue;
      }
      if (al.dyingTimer === -1) continue;
      al.x += al.dx;
      al.phase += 0.04;
      al.y = al.baseY + Math.sin(al.phase) * al.amplitude;
      if (al.x < -20) al.dx = Math.abs(al.dx);
      if (al.x > CW + 4) al.dx = -Math.abs(al.dx);
    }
    if (st.scrolled >= st.nextAlienAt && alienDiff > 0.3) {
      const fromLeft = Math.random() > 0.5;
      const spawnY = CH * 0.15 + Math.random() * CH * 0.55;
      st.aliens.push({
        x: fromLeft ? -16 : CW + 16,
        y: spawnY,
        baseY: spawnY,
        dx: (fromLeft ? 1 : -1) * (0.6 + alienDiff * 0.5 + Math.random() * 0.4),
        phase: Math.random() * Math.PI * 2,
        amplitude: 20 + Math.random() * 30,
        dyingTimer: 0,
      });
      st.nextAlienAt += Math.max(800, 1600 - alienDiff * 400);
    }

    // Jetpack pickup
    if (st.jetpackFrames > 0) st.jetpackFrames--;
    if (st.scrolled >= st.nextJetpackAt && !st.jetpackPickup) {
      const candidates = st.plats.filter(
        (p) => p.y < -20 && p.y > -CH * 2 && p.type === 'solid' && !p.hasSpring,
      );
      const host = candidates[Math.floor(Math.random() * candidates.length)];
      if (host) {
        st.jetpackPickup = { x: host.x + host.w / 2 - 14, y: host.y - 28 };
        st.nextJetpackAt += 6000 + Math.random() * 2000;
      }
    }
    if (st.jetpackPickup) {
      if (st.jetpackPickup.y > CH + 40) {
        st.jetpackPickup = null;
      } else {
        const jp = st.jetpackPickup;
        if (
          st.px + FW * 0.4 > jp.x &&
          st.px - FW * 0.4 < jp.x + 28 &&
          st.py + FH > jp.y &&
          st.py < jp.y + 28
        ) {
          st.jetpackFrames = JETPACK_DURATION;
          st.jetpackPickup = null;
          this.sfxJetpack.currentTime = 0;
          void this.sfxJetpack.play().catch(() => {});
        }
      }
    }
    st.aliens = st.aliens.filter(
      (al) => al.dyingTimer !== -1 && (al.dyingTimer > 0 || al.y < CH + 40),
    );

    // Black holes
    if (st.scrolled >= st.nextBlackHoleAt) {
      st.blackHoles.push({ x: 35 + Math.random() * (CW - 70), y: -CH * 0.5, angle: 0 });
      st.nextBlackHoleAt += 6000 + Math.random() * 4000;
    }
    let closestBhDist = Infinity;
    for (const bh of st.blackHoles) {
      bh.angle += 0.025;
      const bdx = bh.x - st.px,
        bdy = bh.y - (st.py + FH / 2);
      const dist = Math.sqrt(bdx * bdx + bdy * bdy);
      if (dist < closestBhDist) closestBhDist = dist;
      if (dist < BH_RADIUS && !st.suckedIn) {
        st.suckedIn = true;
        st.suckTimer = 70;
        st.suckBhX = bh.x;
        st.suckBhY = bh.y;
        st.deathCause = 'blackhole';
        this.sfxBlackHole.volume = 0;
        this.sfxBlackHole.pause();
        this.writeScore();
      } else if (dist < BH_PULL_RADIUS) {
        const pull = 1.2 * Math.pow(1 - dist / BH_PULL_RADIUS, 2);
        st.pvx += (bdx / dist) * pull;
        st.pvy += (bdy / dist) * pull;
      }
    }
    st.blackHoles = st.blackHoles.filter((bh) => bh.y < CH + 60);

    // Proximity audio
    const ALIEN_WARN = 340,
      BH_WARN = 380;
    let closestAlienDist = Infinity;
    for (const al of st.aliens) {
      if (al.dyingTimer !== 0) continue;
      const d = Math.sqrt((al.x + 24 - st.px) ** 2 + (al.y + 24 - (st.py + FH / 2)) ** 2);
      if (d < closestAlienDist) closestAlienDist = d;
    }
    if (closestAlienDist < ALIEN_WARN) {
      const vol = Math.max(0, Math.min(0.7, 1 - closestAlienDist / ALIEN_WARN));
      if (this.sfxAlienProximity.paused) void this.sfxAlienProximity.play().catch(() => {});
      this.sfxAlienProximity.volume = vol;
    } else {
      this.sfxAlienProximity.volume = 0;
    }

    if (closestBhDist < BH_WARN) {
      const vol = Math.max(0, Math.min(1, 1 - (closestBhDist - BH_RADIUS) / (BH_WARN - BH_RADIUS)));
      if (this.sfxBlackHole.paused) void this.sfxBlackHole.play().catch(() => {});
      this.sfxBlackHole.volume = vol;
    } else {
      this.sfxBlackHole.volume = 0;
    }

    // Alien collision
    for (const al of st.aliens) {
      if (al.dyingTimer !== 0) continue;
      if (!(st.px + FW * 0.28 > al.x + 6 && st.px - FW * 0.28 < al.x + 42)) continue;
      if (!(playerBottom > al.y + 8 && st.py < al.y + 44)) continue;
      if (st.pvy > 0 && playerBottom - (al.y + 8) < 20) {
        al.dyingTimer = 22;
        st.pvy = this.BNCE;
        st.py = al.y + 8 - FH;
        this.sfxEnemyDeath.currentTime = 0;
        void this.sfxEnemyDeath.play().catch(() => {});
      } else {
        st.suckedIn = true;
        st.suckTimer = 70;
        st.suckBhX = al.x + 24;
        st.suckBhY = al.y + 24;
        st.deathCause = 'alien';
        this.writeScore();
        for (const el of [
          this.sfxAlienProximity,
          this.sfxBlackHole,
          this.sfxAmbience,
          this.sfxLand,
          this.sfxBoing,
          this.sfxEnemyDeath,
          this.sfxStart,
          this.sfxJetpack,
        ]) {
          el.pause();
          el.currentTime = 0;
        }
        this.sfxAlien.currentTime = 0;
        void this.sfxAlien.play().catch(() => {});
        break;
      }
    }

    // Platform updates
    for (const p of st.plats) {
      if (p.crumbleTimer > 0) {
        p.crumbleTimer--;
        if (p.crumbleTimer === 0) p.crumbleTimer = -200;
      } else if (p.crumbleTimer < -1) p.crumbleTimer++;
      if (p.type === 'moving') {
        p.x += p.dx;
        if (p.x < 0 || p.x + p.w > CW) p.dx *= -1;
      }
    }

    // Camera scroll
    const targetY = CH * 0.4;
    if (st.py < targetY) {
      const scroll = targetY - st.py;
      st.py = targetY;
      for (const p of st.plats) p.y += scroll;
      for (const al of st.aliens) {
        al.y += scroll;
        al.baseY += scroll;
      }
      for (const bh of st.blackHoles) bh.y += scroll;
      if (st.jetpackPickup) st.jetpackPickup.y += scroll;
      st.scrolled += scroll;
      st.score = Math.floor(st.scrolled / 8);
      if (st.score > st.hi) st.hi = st.score;
    }

    // Cull + generate
    st.plats = st.plats.filter((p) => p.y < CH + 20);
    const topmost = st.plats.length ? Math.min(...st.plats.map((p) => p.y)) : CH;
    if (topmost > -CH) st.plats.push(...generatePlatforms(-3000, topmost - 130, st.scrolled));

    // Fall death
    if (st.py > CH + 20) {
      st.dead = true;
      st.deathCause = 'fall';
      this.playDeathJingle();
      this.writeScore();
    }

    // ── Render ───────────────────────────────────────────────────────────────
    for (const bh of st.blackHoles) this.drawBlackHole(bh);
    for (const p of st.plats) this.drawPlat(p);
    if (st.jetpackPickup) this.drawJetpackPickup(st.jetpackPickup.x, st.jetpackPickup.y);
    for (const al of st.aliens) this.drawAlien(al);
    this.drawPlayer(st.px - FW / 2, st.py, st.facing);

    if (st.jetpackFrames > 0) {
      const flicker = Math.random() > 0.4;
      ctx.fillStyle = flicker ? '#f97316' : '#fbbf24';
      ctx.globalAlpha = 0.85;
      ctx.fillRect(
        Math.round(st.px - FW * 0.2),
        Math.round(st.py + FH),
        Math.round(FW * 0.4),
        5 + Math.floor(Math.random() * 4),
      );
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#f97316';
      ctx.fillRect(4, CH - 8, Math.floor((st.jetpackFrames / JETPACK_DURATION) * (CW - 8)), 4);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(4, CH - 8, Math.floor((st.jetpackFrames / JETPACK_DURATION) * (CW - 8)) - 2, 2);
    }

    st.tick++;
    if (st.tick >= 8) {
      st.animFrame = (st.animFrame + 1) % this.COLS;
      st.tick = 0;
    }
    this.drawHud();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    this.canvas.removeEventListener('touchstart', this.onTouch);
    this.canvas.removeEventListener('touchmove', this.onTouch);
    this.canvas.removeEventListener('touchend', this.onTouchEnd);
    this.sfxAmbience.pause();
    this.sfxAlienProximity.pause();
    this.sfxBlackHole.pause();
  }
}

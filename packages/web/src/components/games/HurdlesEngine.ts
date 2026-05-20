import type { Agent } from '@atproto/api';
import { authFetch } from '../../lib/api';

export type HurdlesDifficulty = 'fast' | 'faster';

export interface HurdlesSpriteRecord {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  width: number;
  height: number;
  spriteSheet: { ref: { $link: string } };
}

export interface HurdlesDeathInfo {
  score: number;
  hi: number;
  rank: number | null;
  result: 'leaderboard' | 'best' | 'lose';
}

async function writeHurdlesStats(agent: Agent, viewerDid: string, score: number, system: string) {
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
          _meta: { name: base },
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

export class HurdlesEngine {
  agent: Agent | null = null;
  viewerDid: string | null = null;
  leaderboard: { did: string; score: number }[] = [];

  onDeath?: (info: HurdlesDeathInfo) => void;
  onScore?: (score: number, difficulty: HurdlesDifficulty) => void;
  onClose?: () => void;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private difficulty: HurdlesDifficulty;
  private practiceMode: boolean;
  private system: string;
  private initSpeed: number;
  private initSpawnIn: number;

  private sprite: HurdlesSpriteRecord | null = null;
  private img: HTMLImageElement | null = null;
  private FW = 48;
  private FH = 48;
  private COLS = 3;

  // Canvas dimensions (fixed)
  private readonly CW = 680;
  private readonly CH = 240;
  private readonly GROUND = 200; // CH - 40
  private readonly PX = 80;
  private readonly GRAVITY = 0.55;
  private readonly JUMP_V = -13;
  private readonly SCALE = 2;

  private stars: { x: number; y: number; size: number; brightness: number; speed: number }[];

  private st!: {
    y: number;
    vy: number;
    grounded: boolean;
    dj: boolean;
    obs: { x: number; w: number; h: number }[];
    score: number;
    speed: number;
    animFrame: number;
    tick: number;
    dead: boolean;
    started: boolean;
    spawnIn: number;
    hi: number;
    prevHi: number;
    deathResult: 'leaderboard' | 'best' | 'lose';
  };

  private raf = 0;
  private lastFrameTime = 0;
  private readonly FRAME_MS = 1000 / 60;
  private scoreWritten = false;
  private deathReported = false;

  constructor(
    canvas: HTMLCanvasElement,
    config: { difficulty: HurdlesDifficulty; practiceMode?: boolean },
  ) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
    this.difficulty = config.difficulty;
    this.practiceMode = config.practiceMode ?? false;
    this.system = `hurdles_${config.difficulty}`;
    this.initSpeed = config.difficulty === 'faster' ? 11 : 7.5;
    this.initSpawnIn = config.difficulty === 'faster' ? 60 : 90;

    this.stars = Array.from({ length: 60 }, () => ({
      x: Math.random() * this.CW,
      y: Math.random() * (this.GROUND - 10),
      size: Math.random() > 0.85 ? 2 : 1,
      brightness: 0.3 + Math.random() * 0.7,
      speed: 0.2 + Math.random() * 0.4,
    }));

    window.addEventListener('keydown', this.onKey);
    canvas.addEventListener('click', this.tryJump);

    this.initState();
    this.fetchHiScore();
    this.raf = requestAnimationFrame(this.loop);
  }

  private initState(): void {
    this.st = {
      y: 0,
      vy: 0,
      grounded: true,
      dj: false,
      obs: [],
      score: 0,
      speed: this.initSpeed,
      animFrame: 0,
      tick: 0,
      dead: false,
      started: false,
      spawnIn: this.initSpawnIn,
      hi: 0,
      prevHi: 0,
      deathResult: 'lose',
    };
  }

  private fetchHiScore(): void {
    const st = this.st;
    if (!this.practiceMode && this.agent && this.viewerDid) {
      this.agent.com.atproto.repo
        .getRecord({ repo: this.viewerDid, collection: 'actor.rpg.stats', rkey: 'self' })
        .then((res) => {
          const gd = (res.data.value as Record<string, unknown> | undefined)?.hurdles as
            | Record<string, unknown>
            | undefined;
          const dd = gd?.[this.difficulty] as { best?: number } | undefined;
          st.hi = dd?.best ?? 0;
          st.prevHi = st.hi;
        })
        .catch(() => {});
    } else {
      const v = parseInt(
        localStorage.getItem(`protoimsg:practice:hurdles_${this.difficulty}:best`) ?? '0',
        10,
      );
      st.hi = v;
      st.prevHi = v;
    }
  }

  updateActor(sprite: HurdlesSpriteRecord | null, img: HTMLImageElement | null): void {
    this.sprite = sprite;
    this.img = img;
    this.FW = (sprite?.frameWidth ?? 24) * this.SCALE;
    this.FH = (sprite?.frameHeight ?? 24) * this.SCALE;
    this.COLS = sprite?.columns ?? 3;
  }

  updateLeaderboard(entries: { did: string; score: number }[]): void {
    this.leaderboard = entries;
  }

  updateAuth(agent: Agent | null, viewerDid: string | null): void {
    this.agent = agent;
    this.viewerDid = viewerDid;
  }

  startGame(): void {
    this.st.started = true;
  }

  restart(): void {
    this.deathReported = false;
    this.scoreWritten = false;
    const prevHi = this.st.hi;
    this.initState();
    this.st.hi = prevHi;
    this.st.prevHi = prevHi;
    this.st.started = true;
  }

  private tryJump = () => {
    const { st } = this;
    if (!st.started || st.dead) return;
    if (st.grounded) {
      st.vy = this.JUMP_V;
      st.grounded = false;
      st.dj = false;
    } else if (!st.dj) {
      st.vy = this.JUMP_V * 0.85;
      st.dj = true;
    }
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === ' ') {
      if (this.st.started && !this.st.dead) {
        e.preventDefault();
        this.tryJump();
      }
    }
    if (e.key === 'Escape') this.onClose?.();
  };

  private writeScore(): void {
    if (this.scoreWritten) return;
    this.scoreWritten = true;
    const { st } = this;
    if (st.score > st.hi) st.hi = st.score;
    const entries = this.leaderboard;
    const isNewBest = st.score > 0 && st.score > st.prevHi;
    const canPost = !this.practiceMode && !!(this.agent && this.viewerDid);
    const wouldQualify = entries.length < 5 || st.score > (entries.at(-1)?.score ?? 0);
    const onBoard = canPost && isNewBest && wouldQualify;
    st.deathResult = onBoard ? 'leaderboard' : isNewBest ? 'best' : 'lose';
    this.onScore?.(st.score, this.difficulty);
    if (canPost && this.agent && this.viewerDid) {
      void writeHurdlesStats(this.agent, this.viewerDid, st.score, this.system);
      void authFetch('/api/games/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: this.system, score: st.score }),
      });
    } else {
      const lsKey = `protoimsg:practice:hurdles_${this.difficulty}:best`;
      if (isNewBest) localStorage.setItem(lsKey, String(st.score));
    }
  }

  private drawPlayer(): void {
    const ctx = this.ctx;
    const { img, sprite, FW, FH, PX, GROUND, st } = this;
    const py = GROUND - FH - st.y;
    if (img && sprite) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        img,
        st.animFrame * sprite.frameWidth,
        2 * sprite.frameHeight,
        sprite.frameWidth,
        sprite.frameHeight,
        PX,
        py,
        FW,
        FH,
      );
    } else {
      ctx.fillStyle = '#7c3aed';
      ctx.fillRect(PX + 4, py + 8, FW - 8, FH - 8);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(PX + 6, py, FW - 12, Math.round(FH * 0.45));
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(PX + 10, py + 4, 4, 4);
      ctx.fillRect(PX + FW - 18, py + 4, 4, 4);
    }
  }

  private drawCactus(x: number, w: number, h: number): void {
    const ctx = this.ctx;
    const { GROUND } = this;
    ctx.fillStyle = '#2d6a27';
    const sw = Math.max(4, Math.round(w * 0.36));
    const sx = x + (w - sw) / 2;
    ctx.fillRect(sx, GROUND - h, sw, h);
    if (h > 24) {
      const aw = Math.round(w * 0.32),
        at = Math.round(h * 0.32),
        ah = Math.round(h * 0.38);
      ctx.fillRect(x, GROUND - h + at, aw, sw);
      ctx.fillRect(x, GROUND - h + at - ah, aw, ah);
      ctx.fillRect(x + w - aw, GROUND - h + at + 10, aw, sw);
      ctx.fillRect(
        x + w - aw,
        GROUND - h + at + 10 - Math.round(ah * 0.65),
        aw,
        Math.round(ah * 0.65),
      );
    }
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
    const { CW, CH, GROUND, st } = this;

    ctx.clearRect(0, 0, CW, CH);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, CW, CH);

    if (st.started && !st.dead) {
      for (const s of this.stars) {
        s.x -= st.speed * s.speed;
        if (s.x < -2) s.x += CW + 2;
      }
    }
    for (const s of this.stars) {
      ctx.globalAlpha = s.brightness;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.round(s.x), Math.round(s.y), s.size, s.size);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#334155';
    ctx.fillRect(0, GROUND, CW, 2);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, GROUND + 2, CW, CH - GROUND - 2);

    if (!st.started) {
      this.drawPlayer();
      return;
    }

    if (st.dead) {
      this.drawPlayer();
      for (const o of st.obs) this.drawCactus(o.x, o.w, o.h);
      if (!this.deathReported) {
        this.deathReported = true;
        const board = this.leaderboard;
        const rank = board.length > 0 ? board.filter((e) => e.score > st.score).length + 1 : null;
        this.onDeath?.({ score: st.score, hi: st.hi, rank, result: st.deathResult });
      }
      return;
    }

    if (!st.grounded) {
      st.vy += this.GRAVITY;
      st.y -= st.vy;
      if (st.y <= 0) {
        st.y = 0;
        st.vy = 0;
        st.grounded = true;
      }
    }

    st.score++;
    st.speed = this.initSpeed + st.score / (this.difficulty === 'faster' ? 120 : 200);
    st.spawnIn--;
    if (st.spawnIn <= 0) {
      const h = 36 + Math.random() * 36,
        w = 18 + Math.random() * 14;
      st.obs.push({ x: CW + 10, w, h });
      st.spawnIn = Math.max(52, 115 - Math.floor(st.score / 150) * 8) + Math.random() * 60;
    }
    st.obs = st.obs.map((o) => ({ ...o, x: o.x - st.speed })).filter((o) => o.x > -60);

    const { FW, FH, PX } = this;
    const hx = PX + Math.round(FW * 0.3);
    const hw = Math.round(FW * 0.4);
    const hh = Math.round(FH * 0.45);
    const hy = GROUND - hh - st.y;
    for (const o of st.obs) {
      const ox = o.x + Math.round(o.w * 0.15),
        ow = Math.round(o.w * 0.7);
      if (hx < ox + ow && hx + hw > ox && hy < GROUND && hy + hh > GROUND - o.h) {
        st.dead = true;
        this.writeScore();
        break;
      }
    }

    st.tick++;
    if (st.tick >= 7) {
      st.animFrame = (st.animFrame + 1) % this.COLS;
      st.tick = 0;
    }

    this.drawPlayer();
    for (const o of st.obs) this.drawCactus(o.x, o.w, o.h);
    ctx.fillStyle = '#475569';
    ctx.font = '13px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`HI ${st.hi}  ${st.score}`, CW - 10, 22);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    this.canvas.removeEventListener('click', this.tryJump);
  }
}

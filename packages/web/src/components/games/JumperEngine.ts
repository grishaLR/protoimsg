import {
  JumperSim,
  PLAYER_H,
  type JumperDifficulty,
  type JumperInputLog,
  type Plat,
  type Alien,
  type BlackHole,
} from '@protoimsg/game-sim';
import type { Agent } from '@atproto/api';

export type { JumperDifficulty };

const CW = 352;
const CH = 520;
const PLAT_H = 10;
const BH_RADIUS = 20;
const BH_PULL_RADIUS = 100;
const JETPACK_DURATION = 210;

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

/** A finished run, handed to the host for persistence / server submission. */
export interface JumperRun {
  score: number;
  ticks: number;
  inputLog: JumperInputLog;
}

type Phase = 'start' | 'playing' | 'suck' | 'deadDelay' | 'dead';

/**
 * Renderer + audio + input layer wrapped around the deterministic JumperSim.
 *
 * All gameplay logic lives in JumperSim; this class only draws sim state,
 * plays sound, records the input log, and orchestrates the death animation.
 * The score is whatever the sim computed — never reported by this layer.
 */
export class JumperEngine {
  // Updated by the React wrapper between frames.
  agent: Agent | null = null;
  viewerDid: string | null = null;
  leaderboard: { did: string; score: number }[] = [];

  onDeath?: (info: JumperDeathInfo) => void;
  onScore?: (score: number, difficulty: JumperDifficulty) => void;
  /** Fired once per run when NOT in practice mode — host submits to server. */
  onSubmitRun?: (run: JumperRun) => void;
  onClose?: () => void;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private difficulty: JumperDifficulty;
  private practiceMode: boolean;

  private sim: JumperSim;
  private inputLog: JumperInputLog = [];
  private prevInput = { left: false, right: false };

  private phase: Phase = 'start';
  private suckTimer = 0;
  private suckBhX = 0;
  private suckBhY = 0;
  private deadDelay = 0;
  private deadFrames = 0;
  private deathCause: 'fall' | 'alien' | 'blackhole' = 'fall';
  private deathResult: 'leaderboard' | 'best' | 'lose' = 'lose';
  private deathReported = false;

  private hi = 0;
  private prevHi = 0;

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

  private keys = { left: false, right: false };
  private touchLeft = false;
  private touchRight = false;
  private raf = 0;
  private lastFrameTime = 0;
  private readonly FRAME_MS = 1000 / 60;
  private animFrame = 0;
  private animTick = 0;
  private alienEndedHandler: (() => void) | null = null;
  private stars: { x: number; y: number; size: number; brightness: number }[];

  constructor(
    canvas: HTMLCanvasElement,
    config: { difficulty: JumperDifficulty; practiceMode?: boolean; seed: number },
  ) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
    this.difficulty = config.difficulty;
    this.practiceMode = config.practiceMode ?? false;
    this.sim = new JumperSim(config.seed, config.difficulty);

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

    this.fetchHiScore();
    this.raf = requestAnimationFrame(this.loop);
  }

  private fetchHiScore(): void {
    if (!this.practiceMode && this.agent && this.viewerDid) {
      this.agent.com.atproto.repo
        .getRecord({ repo: this.viewerDid, collection: 'actor.rpg.stats', rkey: 'self' })
        .then((res) => {
          const gd = (res.data.value as Record<string, unknown> | undefined)?.jumper as
            | Record<string, unknown>
            | undefined;
          const dd = gd?.[this.difficulty] as { best?: number } | undefined;
          this.hi = dd?.best ?? 0;
          this.prevHi = this.hi;
        })
        .catch(() => {});
    } else {
      const v = parseInt(
        localStorage.getItem(`protoimsg:practice:jumper_${this.difficulty}:best`) ?? '0',
        10,
      );
      this.hi = v;
      this.prevHi = v;
    }
  }

  updateActor(sprite: SpriteRecord | null, img: HTMLImageElement | null): void {
    this.sprite = sprite;
    this.img = img;
    this.FW = Math.round(sprite?.frameWidth ?? 16);
    this.FH = Math.round(sprite?.frameHeight ?? 16);
    this.COLS = sprite?.columns ?? 3;
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
    this.phase = 'playing';
    this.sfxStart.currentTime = 0;
    void this.sfxStart.play().catch(() => {});
  }

  /** Begin a fresh run with a new seed. Host supplies the seed. */
  restart(seed: number): void {
    this.sim = new JumperSim(seed, this.difficulty);
    this.inputLog = [];
    this.prevInput = { left: false, right: false };
    this.deathReported = false;
    this.deathResult = 'lose';
    this.deathCause = 'fall';
    this.deadFrames = 0;
    this.deadDelay = 0;
    this.suckTimer = 0;
    this.animFrame = 0;
    this.animTick = 0;
    this.prevHi = this.hi;
    this.sfxBlackHole.volume = 0;
    this.sfxBlackHole.pause();
    this.sfxAlienProximity.volume = 0;
    this.sfxAlienProximity.pause();
    for (const el of [this.sfxLose, this.sfxWin, this.sfxAchievement]) {
      el.pause();
      el.currentTime = 0;
    }
    this.startGame();
  }

  // ── Input ──────────────────────────────────────────────────────────────

  private onKey = (e: KeyboardEvent) => {
    const down = e.type === 'keydown';
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
      if (this.phase === 'playing') {
        this.keys.left = down;
        e.preventDefault();
      }
    }
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      if (this.phase === 'playing') {
        this.keys.right = down;
        e.preventDefault();
      }
    }
    if (e.key === 'Escape') this.onClose?.();
  };

  private onTouch = (e: TouchEvent) => {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    this.touchLeft = false;
    this.touchRight = false;
    for (let i = 0; i < e.touches.length; i++) {
      const tx = (e.touches[i]?.clientX ?? 0) - rect.left;
      if (tx < CW / 2) this.touchLeft = true;
      else this.touchRight = true;
    }
  };

  private onTouchEnd = () => {
    this.touchLeft = false;
    this.touchRight = false;
  };

  // ── Main loop ──────────────────────────────────────────────────────────

  private loop = (now: number) => {
    if (now - this.lastFrameTime < this.FRAME_MS - 1) {
      this.raf = requestAnimationFrame(this.loop);
      return;
    }
    this.lastFrameTime = now;
    this.frame();
    this.raf = requestAnimationFrame(this.loop);
  };

  private frame(): void {
    this.drawBg();
    switch (this.phase) {
      case 'start':
        this.renderStart();
        return;
      case 'playing':
        this.tickPlaying();
        return;
      case 'suck':
        this.renderSuck();
        return;
      case 'deadDelay':
        this.renderDeadDelay();
        return;
      case 'dead':
        this.renderDead();
        return;
    }
  }

  private tickPlaying(): void {
    const input = {
      left: this.keys.left || this.touchLeft,
      right: this.keys.right || this.touchRight,
    };
    if (input.left !== this.prevInput.left || input.right !== this.prevInput.right) {
      this.inputLog.push({ t: this.sim.state.tick, l: input.left, r: input.right });
      this.prevInput = { ...input };
    }

    this.sim.step(input);
    this.playStepSfx();
    this.updateProximityAudio();

    if (this.sim.state.dead) {
      this.onDied();
      return;
    }

    this.animTick++;
    if (this.animTick >= 8) {
      this.animFrame = (this.animFrame + 1) % this.COLS;
      this.animTick = 0;
    }
    this.renderWorld();
  }

  private playStepSfx(): void {
    for (const ev of this.sim.events) {
      if (ev === 'land' || ev === 'crumble') {
        this.sfxLand.currentTime = 0;
        void this.sfxLand.play().catch(() => {});
      } else if (ev === 'spring') {
        this.sfxBoing.currentTime = 0;
        void this.sfxBoing.play().catch(() => {});
      } else if (ev === 'stomp') {
        this.sfxEnemyDeath.currentTime = 0;
        void this.sfxEnemyDeath.play().catch(() => {});
      } else {
        this.sfxJetpack.currentTime = 0;
        void this.sfxJetpack.play().catch(() => {});
      }
    }
  }

  private updateProximityAudio(): void {
    const st = this.sim.state;
    const cy = st.py + PLAYER_H / 2;
    const ALIEN_WARN = 340;
    const BH_WARN = 380;
    let closestAlienDist = Infinity;
    for (const al of st.aliens) {
      if (al.dyingTimer !== 0) continue;
      const d = Math.sqrt((al.x + 24 - st.px) ** 2 + (al.y + 24 - cy) ** 2);
      if (d < closestAlienDist) closestAlienDist = d;
    }
    if (closestAlienDist < ALIEN_WARN) {
      const vol = Math.max(0, Math.min(0.7, 1 - closestAlienDist / ALIEN_WARN));
      if (this.sfxAlienProximity.paused) void this.sfxAlienProximity.play().catch(() => {});
      this.sfxAlienProximity.volume = vol;
    } else {
      this.sfxAlienProximity.volume = 0;
    }

    let closestBhDist = Infinity;
    for (const bh of st.blackHoles) {
      const d = Math.sqrt((bh.x - st.px) ** 2 + (bh.y - cy) ** 2);
      if (d < closestBhDist) closestBhDist = d;
    }
    if (closestBhDist < BH_WARN) {
      const vol = Math.max(0, Math.min(1, 1 - (closestBhDist - BH_RADIUS) / (BH_WARN - BH_RADIUS)));
      if (this.sfxBlackHole.paused) void this.sfxBlackHole.play().catch(() => {});
      this.sfxBlackHole.volume = vol;
    } else {
      this.sfxBlackHole.volume = 0;
    }
  }

  private onDied(): void {
    const st = this.sim.state;
    this.deathCause = st.deathCause;
    const isNewBest = st.score > 0 && st.score > this.prevHi;
    const canPost = !this.practiceMode && !!(this.agent && this.viewerDid);
    const entries = this.leaderboard;
    const wouldQualify = entries.length < 5 || st.score > (entries.at(-1)?.score ?? 0);
    const onBoard = canPost && isNewBest && wouldQualify;
    this.deathResult = onBoard ? 'leaderboard' : isNewBest ? 'best' : 'lose';
    if (st.score > this.hi) this.hi = st.score;

    this.onScore?.(st.score, this.difficulty);
    if (this.practiceMode) {
      if (isNewBest) {
        localStorage.setItem(`protoimsg:practice:jumper_${this.difficulty}:best`, String(st.score));
      }
    } else {
      this.onSubmitRun?.({ score: st.score, ticks: st.tick, inputLog: this.inputLog });
    }

    if (this.deathCause === 'fall') {
      this.playDeathJingle();
      this.phase = 'dead';
      return;
    }

    // Black hole / alien — run the spaghettification animation toward the killer.
    if (this.deathCause === 'blackhole') {
      let nearest: BlackHole | null = null;
      let best = Infinity;
      for (const bh of st.blackHoles) {
        const d = (bh.x - st.px) ** 2 + (bh.y - st.py) ** 2;
        if (d < best) {
          best = d;
          nearest = bh;
        }
      }
      this.suckBhX = nearest ? nearest.x : st.px;
      this.suckBhY = nearest ? nearest.y : st.py;
      this.sfxBlackHole.volume = 0;
      this.sfxBlackHole.pause();
    } else {
      let killer: Alien | null = null;
      let best = Infinity;
      for (const al of st.aliens) {
        const d = (al.x + 24 - st.px) ** 2 + (al.y + 24 - st.py) ** 2;
        if (d < best) {
          best = d;
          killer = al;
        }
      }
      this.suckBhX = killer ? killer.x + 24 : st.px;
      this.suckBhY = killer ? killer.y + 24 : st.py;
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
    }
    this.suckTimer = 70;
    this.phase = 'suck';
  }

  private playDeathJingle(): void {
    if (this.deathResult === 'leaderboard') {
      this.sfxWin.currentTime = 0;
      void this.sfxWin.play().catch(() => {});
    } else if (this.deathResult === 'best') {
      this.sfxAchievement.currentTime = 0;
      void this.sfxAchievement.play().catch(() => {});
    } else {
      this.sfxLose.currentTime = 0;
      void this.sfxLose.play().catch(() => {});
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  private renderStart(): void {
    const st = this.sim.state;
    for (const p of st.plats) this.drawPlat(p);
    this.drawPlayer(st.px, st.py, st.facing);
  }

  private renderWorld(): void {
    const st = this.sim.state;
    for (const bh of st.blackHoles) this.drawBlackHole(bh);
    for (const p of st.plats) this.drawPlat(p);
    if (st.jetpackPickup) this.drawJetpackPickup(st.jetpackPickup.x, st.jetpackPickup.y);
    for (const al of st.aliens) this.drawAlien(al);
    this.drawPlayer(st.px, st.py, st.facing);

    if (st.jetpackFrames > 0) {
      const ctx = this.ctx;
      const flicker = Math.random() > 0.4;
      ctx.fillStyle = flicker ? '#f97316' : '#fbbf24';
      ctx.globalAlpha = 0.85;
      ctx.fillRect(
        Math.round(st.px - this.FW * 0.2),
        Math.round(st.py + PLAYER_H),
        Math.round(this.FW * 0.4),
        5 + Math.floor(Math.random() * 4),
      );
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#f97316';
      ctx.fillRect(4, CH - 8, Math.floor((st.jetpackFrames / JETPACK_DURATION) * (CW - 8)), 4);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(4, CH - 8, Math.floor((st.jetpackFrames / JETPACK_DURATION) * (CW - 8)) - 2, 2);
    }
    this.drawHud();
  }

  private renderSuck(): void {
    const st = this.sim.state;
    const ctx = this.ctx;
    const { FW, FH } = this;
    for (const p of st.plats) this.drawPlat(p);
    if (this.deathCause === 'blackhole') for (const bh of st.blackHoles) this.drawBlackHole(bh);
    if (this.deathCause === 'alien') for (const al of st.aliens) this.drawAlien(al);

    const t = 1 - this.suckTimer / 70;
    const ease = t * t;
    const px = st.px - FW / 2;
    const py = st.py + PLAYER_H - FH;
    const cx = px + FW / 2 + (this.suckBhX - (px + FW / 2)) * ease;
    const cy = py + FH / 2 + (this.suckBhY - (py + FH / 2)) * ease;
    ctx.save();
    ctx.translate(Math.round(cx), Math.round(cy));
    ctx.rotate(t * Math.PI * 8);
    ctx.scale(Math.max(0, 1 - ease), Math.max(0, 1 - ease));
    const { img, sprite } = this;
    if (img && sprite) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        img,
        this.animFrame * sprite.frameWidth,
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

    this.suckTimer--;
    if (this.suckTimer <= 0) {
      this.phase = 'deadDelay';
      this.deadDelay = 50;
      if (this.deathCause === 'alien' && !this.sfxAlien.paused) {
        this.alienEndedHandler = () => {
          this.alienEndedHandler = null;
          this.playDeathJingle();
        };
        this.sfxAlien.addEventListener('ended', this.alienEndedHandler, { once: true });
      } else {
        this.playDeathJingle();
      }
    }
  }

  private renderDeadDelay(): void {
    const st = this.sim.state;
    this.deadDelay--;
    if (this.deadDelay <= 0) this.phase = 'dead';
    for (const p of st.plats) this.drawPlat(p);
    if (this.deathCause === 'blackhole') for (const bh of st.blackHoles) this.drawBlackHole(bh);
    if (this.deathCause === 'alien') for (const al of st.aliens) this.drawAlien(al);
  }

  private renderDead(): void {
    const st = this.sim.state;
    this.deadFrames++;
    for (const p of st.plats) this.drawPlat(p);
    if (!this.deathReported) {
      this.deathReported = true;
      const board = this.leaderboard;
      const rank = board.length > 0 ? board.filter((e) => e.score > st.score).length + 1 : null;
      this.onDeath?.({
        score: st.score,
        hi: this.hi,
        rank,
        cause: this.deathCause,
        result: this.deathResult,
      });
    }
  }

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

  /**
   * Draws the character. The sim hitbox is a fixed PLAYER_W x PLAYER_H box;
   * the sprite art may be larger and is anchored bottom-centre on that box,
   * so collisions stay fair while the avatar keeps its natural size.
   */
  private drawPlayer(centerX: number, bodyTop: number, facing: 1 | -1): void {
    const ctx = this.ctx;
    const { img, sprite, FW, FH } = this;
    const px = centerX - FW / 2;
    const py = bodyTop + PLAYER_H - FH;
    if (img && sprite) {
      ctx.imageSmoothingEnabled = false;
      ctx.save();
      if (facing === -1) {
        ctx.translate(px + FW, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(
          img,
          this.animFrame * sprite.frameWidth,
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
          this.animFrame * sprite.frameWidth,
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
    const st = this.sim.state;
    const hi = Math.max(this.hi, st.score);
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(CW - 80, 6, 76, 30);
    ctx.fillStyle = '#4ade80';
    ctx.fillText(`${st.score}`, CW - 8, 20);
    ctx.fillStyle = '#64748b';
    ctx.font = '10px monospace';
    ctx.fillText(`BEST ${hi}`, CW - 8, 32);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    this.canvas.removeEventListener('touchstart', this.onTouch);
    this.canvas.removeEventListener('touchmove', this.onTouch);
    this.canvas.removeEventListener('touchend', this.onTouchEnd);
    if (this.alienEndedHandler) {
      this.sfxAlien.removeEventListener('ended', this.alienEndedHandler);
      this.alienEndedHandler = null;
    }
    this.sfxAmbience.pause();
    this.sfxAlienProximity.pause();
    this.sfxBlackHole.pause();
  }
}

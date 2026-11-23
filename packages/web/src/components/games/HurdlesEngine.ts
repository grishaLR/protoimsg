import {
  HurdlesSim,
  hurdlesUfoBob,
  HURDLES_W,
  HURDLES_PLAYER_X,
  HURDLES_CELL,
  type HurdlesDifficulty,
  type HurdlesDeathCause,
  type HurdlesInputLog,
  type HurdlesObstacle,
} from '@protoimsg/game-sim';
import type { Agent } from '@atproto/api';

export type { HurdlesDifficulty };

/** Canvas size. The sim's world is HURDLES_W wide; heights are drawn up from GROUND. */
export const HURDLES_CANVAS_W = HURDLES_W;
export const HURDLES_CANVAS_H = 300;
const CW = HURDLES_CANVAS_W;
const CH = HURDLES_CANVAS_H;
const GROUND = 260;

/** Cap on accumulated time after a long/backgrounded frame — avoids fast-forward. */
const MAX_FRAME_GAP_MS = 250;
/** Max sim steps run per rAF — bounds catch-up so a long frame can't spiral. */
const MAX_CATCHUP_STEPS = 5;
const FRAME_MS = 1000 / 60;
/** How long the "UFOs incoming" banner stays up, in ticks. */
const UFO_WARNING_TICKS = 90;

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
  cause: HurdlesDeathCause;
  result: 'leaderboard' | 'best' | 'lose';
}

/** A finished run, handed to the host for persistence / server submission. */
export interface HurdlesRun {
  score: number;
  ticks: number;
  inputLog: HurdlesInputLog;
}

type Phase = 'start' | 'playing' | 'dead';

// Pixel art, one character per cell. Flowers scale with the obstacle's `p`.
const FLOWER_ART = [
  '..s.s..',
  '.sssss.',
  'sswssss',
  '.sssss.',
  '..s.s..',
  '...p...',
  '.ppp...',
  '...ppp.',
  '...p...',
];
const FLOWER_COLORS: Record<string, string> = { s: '#f472b6', w: '#fbbf24', p: '#4ade80' };
const UFO_ART = [
  '.....ddd.....',
  '....ddwdd....',
  '..bbbbbbbbb..',
  '.bbybbybbybb.',
  'bbbbbbbbbbbbb',
  '..bbbbbbbbb..',
];
const UFO_COLORS: Record<string, string> = {
  d: '#67e8f9',
  w: '#f8fafc',
  b: '#a78bfa',
  y: '#fbbf24',
};

/**
 * Renderer + audio + input layer wrapped around the deterministic HurdlesSim.
 *
 * All gameplay logic lives in HurdlesSim; this class only draws sim state,
 * plays sound and records the jump log. The score is whatever the sim
 * computed — never reported by this layer.
 */
export class HurdlesEngine {
  // Updated by the React wrapper between frames.
  agent: Agent | null = null;
  viewerDid: string | null = null;
  leaderboard: { did: string; score: number }[] = [];

  onDeath?: (info: HurdlesDeathInfo) => void;
  onScore?: (score: number, difficulty: HurdlesDifficulty) => void;
  /** Fired once per run when NOT in practice mode — host submits to server. */
  onSubmitRun?: (run: HurdlesRun) => void;
  onClose?: () => void;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private difficulty: HurdlesDifficulty;
  private practiceMode: boolean;

  private sim: HurdlesSim;
  private inputLog: HurdlesInputLog = [];
  /** A jump press waiting for the next tick. */
  private jumpQueued = false;

  private phase: Phase = 'start';
  private deathResult: 'leaderboard' | 'best' | 'lose' = 'lose';
  private hi = 0;
  private prevHi = 0;
  private ufoWarningTicks = 0;

  private sprite: HurdlesSpriteRecord | null = null;
  private img: HTMLImageElement | null = null;
  private COLS = 3;
  private animFrame = 0;
  private animTick = 0;

  // Audio. The jump thump plays on every jump, so it goes through Web Audio:
  // rewinding and replaying an <audio> element stalls iOS Safari's main thread
  // each time, which makes the jump arc stutter.
  private muted: boolean;
  private sfxAmbience: HTMLAudioElement;
  private sfxAbduct: HTMLAudioElement;
  private sfxLose: HTMLAudioElement;
  private sfxWin: HTMLAudioElement;
  private sfxAchievement: HTMLAudioElement;
  private sfxStart: HTMLAudioElement;
  private audioCtx: AudioContext | null = null;
  private audioOut: GainNode | null = null;
  private thump: AudioBuffer | null = null;
  private abductEndedHandler: (() => void) | null = null;

  private raf = 0;
  private lastFrameTime = 0;
  private accumulator = 0;
  private destroyed = false;
  private stars: { x: number; y: number; size: number; brightness: number; depth: number }[];

  constructor(
    canvas: HTMLCanvasElement,
    config: { difficulty: HurdlesDifficulty; practiceMode?: boolean; seed: number },
  ) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
    this.difficulty = config.difficulty;
    this.practiceMode = config.practiceMode ?? false;
    this.sim = new HurdlesSim(config.seed, config.difficulty);

    // Cosmetic only — the starfield never touches the sim, so Math.random is fine.
    this.stars = Array.from({ length: 70 }, () => ({
      x: Math.random() * CW,
      y: Math.random() * (GROUND - 10),
      size: Math.random() > 0.85 ? 2 : 1,
      brightness: 0.3 + Math.random() * 0.7,
      depth: 0.1 + Math.random() * 0.25,
    }));

    this.muted = localStorage.getItem('protoimsg:sfx-muted') === 'true';
    const a = (file: string, opts?: { loop?: boolean; vol?: number }) => {
      const el = new Audio(`/assets/games/sfx/${file}`);
      el.preload = 'auto';
      if (opts?.loop) el.loop = true;
      if (opts?.vol !== undefined) el.volume = opts.vol;
      el.muted = this.muted;
      return el;
    };
    this.sfxAmbience = a('Ambience_Space_00.mp3', { loop: true, vol: 0.35 });
    this.sfxAbduct = a('Robot_Talk_02.mp3');
    this.sfxLose = a('Jingle_Lose_00.mp3');
    this.sfxWin = a('Jingle_Win_00.mp3');
    this.sfxAchievement = a('Jingle_Achievement_00.mp3');
    this.sfxStart = a('SoundStartLevel.mp3');
    this.loadThump();

    window.addEventListener('keydown', this.onKey);
    canvas.addEventListener('pointerdown', this.onPointer);

    this.fetchHiScore();
    this.raf = requestAnimationFrame(this.loop);
  }

  private loadThump(): void {
    // Older Safari only has the prefixed constructor; some embedded webviews have neither.
    const w = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const AC = w.AudioContext ?? w.webkitAudioContext;
    if (!AC) return;
    try {
      const audioCtx = new AC();
      const out = audioCtx.createGain();
      out.gain.value = this.muted ? 0 : 0.8;
      out.connect(audioCtx.destination);
      this.audioCtx = audioCtx;
      this.audioOut = out;
      fetch('/assets/games/sfx/SoundBlowDull.mp3')
        .then((r) => r.arrayBuffer())
        .then((buf) => audioCtx.decodeAudioData(buf))
        .then((b) => {
          if (!this.destroyed) this.thump = b;
        })
        .catch(() => {
          /* no thump — the game plays on silently */
        });
    } catch {
      /* Web Audio unavailable — the game plays on without the thump */
    }
  }

  private fetchHiScore(): void {
    if (!this.practiceMode && this.agent && this.viewerDid) {
      this.agent.com.atproto.repo
        .getRecord({ repo: this.viewerDid, collection: 'actor.rpg.stats', rkey: 'self' })
        .then((res) => {
          const gd = (res.data.value as Record<string, unknown> | undefined)?.hurdles as
            | Record<string, unknown>
            | undefined;
          const dd = gd?.[this.difficulty] as { best?: number } | undefined;
          // A run may already have finished while this was in flight.
          this.hi = Math.max(this.hi, dd?.best ?? 0);
          if (this.phase !== 'dead') this.prevHi = this.hi;
        })
        .catch(() => {});
    } else if (this.practiceMode) {
      const v = parseInt(
        localStorage.getItem(`protoimsg:practice:hurdles_${this.difficulty}:best`) ?? '0',
        10,
      );
      this.hi = Number.isFinite(v) ? v : 0;
      this.prevHi = this.hi;
    }
  }

  updateActor(sprite: HurdlesSpriteRecord | null, img: HTMLImageElement | null): void {
    this.sprite = sprite;
    this.img = img;
    this.COLS = sprite?.columns ?? 3;
  }

  updateLeaderboard(entries: { did: string; score: number }[]): void {
    this.leaderboard = entries;
  }

  updateAuth(agent: Agent | null, viewerDid: string | null): void {
    const hadAuth = !!(this.agent && this.viewerDid);
    this.agent = agent;
    this.viewerDid = viewerDid;
    // The engine is built before auth is pushed in — load the personal best
    // as soon as there is someone to load it for.
    if (!hadAuth && agent && viewerDid && this.hi === 0) this.fetchHiScore();
  }

  setSfxMuted(muted: boolean): void {
    this.muted = muted;
    localStorage.setItem('protoimsg:sfx-muted', String(muted));
    for (const el of [
      this.sfxAmbience,
      this.sfxAbduct,
      this.sfxLose,
      this.sfxWin,
      this.sfxAchievement,
      this.sfxStart,
    ]) {
      el.muted = muted;
    }
    if (this.audioOut) this.audioOut.gain.value = muted ? 0 : 0.8;
    if (muted) this.sfxAmbience.pause();
    else if (this.phase === 'playing') void this.sfxAmbience.play().catch(() => {});
  }

  startGame(): void {
    this.phase = 'playing';
    this.jumpQueued = false;
    // Start counting time from now — the wait on the start screen is not play.
    this.lastFrameTime = 0;
    this.accumulator = 0;
    // startGame runs inside the PLAY / Try Again click. iOS Safari only lets
    // an AudioContext start from a user gesture, so unlock the thump here.
    if (this.audioCtx?.state === 'suspended') void this.audioCtx.resume().catch(() => {});
    if (!this.muted) void this.sfxAmbience.play().catch(() => {});
    this.sfxStart.currentTime = 0;
    void this.sfxStart.play().catch(() => {});
  }

  /** Begin a fresh run with a new seed. Host supplies the seed. */
  restart(seed: number): void {
    this.sim = new HurdlesSim(seed, this.difficulty);
    this.inputLog = [];
    this.deathResult = 'lose';
    this.prevHi = this.hi;
    this.ufoWarningTicks = 0;
    this.animFrame = 0;
    this.animTick = 0;
    this.stopJingles();
    this.startGame();
  }

  private stopJingles(): void {
    if (this.abductEndedHandler) {
      this.sfxAbduct.removeEventListener('ended', this.abductEndedHandler);
      this.abductEndedHandler = null;
    }
    for (const el of [this.sfxAbduct, this.sfxLose, this.sfxWin, this.sfxAchievement]) {
      el.pause();
      el.currentTime = 0;
    }
  }

  // ── Input ──────────────────────────────────────────────────────────────

  /** Read through a method so control-flow narrowing can't assume the phase is unchanged. */
  private isPlaying(): boolean {
    return this.phase === 'playing';
  }

  private queueJump(): void {
    if (this.phase === 'playing') this.jumpQueued = true;
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      this.onClose?.();
      return;
    }
    if (e.key !== ' ' && e.key !== 'ArrowUp') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (this.phase !== 'playing') return;
    e.preventDefault(); // no page scroll while playing
    // One press, one jump: a held key must not auto-repeat into a double jump.
    if (e.repeat) return;
    this.queueJump();
  };

  private onPointer = (e: PointerEvent) => {
    if (this.phase !== 'playing') return;
    e.preventDefault();
    this.queueJump();
  };

  // ── Main loop ──────────────────────────────────────────────────────────

  // Fixed-timestep loop. The sim is frame-locked — one step() == one tick — so
  // it must advance exactly 60 ticks/sec whatever the display's refresh rate.
  // We accumulate real elapsed time, run however many fixed 1/60 s ticks have
  // passed, then draw once, interpolated between the last two ticks (a 120 Hz
  // screen draws twice per tick — without interpolation every other frame
  // repeats and the jump arc judders).
  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    if (this.lastFrameTime === 0) this.lastFrameTime = now;
    let elapsed = now - this.lastFrameTime;
    this.lastFrameTime = now;
    if (elapsed > MAX_FRAME_GAP_MS) elapsed = MAX_FRAME_GAP_MS;

    if (this.phase === 'playing') {
      this.accumulator += elapsed;
      let steps = 0;
      let alive = true;
      while (alive && this.accumulator >= FRAME_MS && steps < MAX_CATCHUP_STEPS) {
        alive = this.tick();
        this.accumulator -= FRAME_MS;
        steps++;
      }
      // Hit the catch-up cap (a very long frame) — drop the backlog, don't spiral.
      if (steps === MAX_CATCHUP_STEPS) this.accumulator = 0;
    }
    this.render(this.isPlaying() ? Math.min(1, this.accumulator / FRAME_MS) : 1);
  };

  /** Advance one tick. Returns false once the run has ended. */
  private tick(): boolean {
    const jump = this.jumpQueued;
    this.jumpQueued = false;
    if (jump) this.inputLog.push(this.sim.state.tick);

    this.sim.step(jump);

    for (const ev of this.sim.events) {
      if (ev === 'jump') this.playThump(false);
      else if (ev === 'doubleJump') this.playThump(true);
      else this.ufoWarningTicks = UFO_WARNING_TICKS;
    }
    if (this.ufoWarningTicks > 0) this.ufoWarningTicks--;

    if (this.sim.state.dead) {
      this.onDied();
      return false;
    }

    this.animTick++;
    if (this.animTick >= 7) {
      this.animFrame = (this.animFrame + 1) % this.COLS;
      this.animTick = 0;
    }
    return true;
  }

  private playThump(double: boolean): void {
    const { audioCtx, audioOut, thump } = this;
    if (!audioCtx || !audioOut || !thump || this.muted) return;
    if (audioCtx.state === 'suspended') void audioCtx.resume().catch(() => {});
    const src = audioCtx.createBufferSource();
    src.buffer = thump;
    // The double jump plays it faster + higher.
    src.playbackRate.value = double ? 1.45 : 1;
    src.connect(audioOut);
    src.start();
  }

  private onDied(): void {
    const st = this.sim.state;
    this.phase = 'dead';
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
        localStorage.setItem(
          `protoimsg:practice:hurdles_${this.difficulty}:best`,
          String(st.score),
        );
      }
    } else {
      this.onSubmitRun?.({ score: st.score, ticks: st.tick, inputLog: this.inputLog });
    }

    // Cut the ambience, then robot chatter (UFO) → jingle.
    this.sfxAmbience.pause();
    this.sfxAmbience.currentTime = 0;
    if (st.deathCause === 'ufo') {
      this.abductEndedHandler = () => {
        this.abductEndedHandler = null;
        this.playDeathJingle();
      };
      this.sfxAbduct.addEventListener('ended', this.abductEndedHandler, { once: true });
      this.sfxAbduct.currentTime = 0;
      void this.sfxAbduct.play().catch(() => {
        // Playback blocked — `ended` will never fire, so go straight to the jingle.
        if (this.abductEndedHandler) {
          this.sfxAbduct.removeEventListener('ended', this.abductEndedHandler);
          this.abductEndedHandler = null;
          this.playDeathJingle();
        }
      });
    } else {
      this.playDeathJingle();
    }

    const rank = entries.length > 0 ? entries.filter((e) => e.score > st.score).length + 1 : null;
    this.onDeath?.({
      score: st.score,
      hi: this.hi,
      rank,
      cause: st.deathCause,
      result: this.deathResult,
    });
  }

  private playDeathJingle(): void {
    const el =
      this.deathResult === 'leaderboard'
        ? this.sfxWin
        : this.deathResult === 'best'
          ? this.sfxAchievement
          : this.sfxLose;
    el.currentTime = 0;
    void el.play().catch(() => {});
  }

  // ── Render ─────────────────────────────────────────────────────────────

  /** `a` = how far between the previous tick (0) and the latest one (1) to draw. */
  private render(a: number): void {
    const ctx = this.ctx;
    const st = this.sim.state;
    const scrolled = st.prevScrolled + (st.scrolled - st.prevScrolled) * a;
    const y = st.prevY + (st.y - st.prevY) * a;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, CW, CH);

    // Starfield, drifting with the floor.
    ctx.fillStyle = '#ffffff';
    for (const s of this.stars) {
      const span = CW + 4;
      const sx = (((s.x - scrolled * s.depth) % span) + span) % span;
      ctx.globalAlpha = s.brightness;
      ctx.fillRect(Math.round(sx) - 2, Math.round(s.y), s.size, s.size);
    }
    ctx.globalAlpha = 1;

    // Floor, with dashes that scroll at obstacle speed.
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, GROUND, CW, CH - GROUND);
    ctx.fillStyle = '#475569';
    ctx.fillRect(0, GROUND, CW, 2);
    ctx.fillStyle = '#334155';
    const DASH_GAP = 56;
    for (let dx = -(scrolled % DASH_GAP); dx < CW; dx += DASH_GAP) {
      ctx.fillRect(Math.round(dx), GROUND + 12, 18, 2);
      ctx.fillRect(Math.round(dx + DASH_GAP / 2), GROUND + 26, 10, 2);
    }

    for (const o of st.obs) this.drawObstacle(o, a);
    this.drawPlayer(y);

    if (this.phase !== 'start') this.drawHud();
    if (this.phase === 'playing' && this.ufoWarningTicks > 0) {
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#67e8f9';
      // Blink for the last second so it doesn't just vanish.
      if (this.ufoWarningTicks > 40 || Math.floor(this.ufoWarningTicks / 6) % 2 === 0) {
        ctx.fillText('UFOs incoming — duck under the high ones', CW / 2, 48);
      }
    }
  }

  private drawObstacle(o: HurdlesObstacle, a: number): void {
    const ctx = this.ctx;
    const st = this.sim.state;
    const x = Math.round(o.prevX + (o.x - o.prevX) * a);
    const top = Math.round(GROUND - o.alt - hurdlesUfoBob(o, st.score) - o.h);
    const art = o.kind === 'ufo' ? UFO_ART : FLOWER_ART;
    const colors = o.kind === 'ufo' ? UFO_COLORS : FLOWER_COLORS;
    if (o.kind === 'ufo') {
      const cx = x + o.w / 2;
      const cy = top + o.h / 2;
      const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, o.w * 0.7);
      glow.addColorStop(0, 'rgba(103,232,249,0.35)');
      glow.addColorStop(1, 'rgba(103,232,249,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - 12, top - 14, o.w + 24, o.h + 28);
    }
    for (let row = 0; row < art.length; row++) {
      const line = art[row] ?? '';
      for (let col = 0; col < line.length; col++) {
        const color = colors[line.charAt(col)];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(x + col * o.p, top + row * o.p, o.p, o.p);
      }
    }
  }

  /**
   * Draws the character in the sim's fixed HURDLES_CELL box, so what you see
   * is what the collision check uses — whatever sprite the player brought.
   */
  private drawPlayer(y: number): void {
    const ctx = this.ctx;
    const { img, sprite } = this;
    const st = this.sim.state;
    const size = HURDLES_CELL;
    const px = HURDLES_PLAYER_X;
    const py = Math.round(GROUND - size - y);
    if (img && sprite) {
      // Row 2 = facing right. Run cycle on the ground, the middle frame in the
      // air; face front once dead.
      const dead = this.phase === 'dead';
      const row = dead ? 0 : 2;
      const col = dead || !st.grounded || this.phase === 'start' ? 1 : this.animFrame;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        img,
        col * sprite.frameWidth,
        row * sprite.frameHeight,
        sprite.frameWidth,
        sprite.frameHeight,
        px,
        py,
        size,
        size,
      );
    } else {
      ctx.fillStyle = '#7c3aed';
      ctx.fillRect(px + 8, py + Math.round(size * 0.45), size - 16, Math.round(size * 0.55));
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(px + 10, py + 4, size - 20, Math.round(size * 0.45));
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(px + 16, py + 12, 4, 4);
      ctx.fillRect(px + size - 20, py + 12, 4, 4);
    }
  }

  private drawHud(): void {
    const ctx = this.ctx;
    const st = this.sim.state;
    const pad = (n: number) => String(n).padStart(5, '0');
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#64748b';
    ctx.fillText(`HI ${pad(Math.max(this.hi, st.score))}`, CW - 70, 22);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(pad(st.score), CW - 10, 22);
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    this.canvas.removeEventListener('pointerdown', this.onPointer);
    this.stopJingles();
    this.sfxAmbience.pause();
    this.sfxStart.pause();
    void this.audioCtx?.close().catch(() => {});
  }
}

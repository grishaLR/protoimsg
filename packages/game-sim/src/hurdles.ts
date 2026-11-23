// Deterministic hurdles simulation.
//
// Authoritative game logic for the side-scrolling runner: jump the flowers,
// and (from HURDLES_UFO_FROM points) deal with UFOs — low ones to jump, high
// ones to run under, and flower→UFO combos that need a mid-air double jump.
// The browser runs it to render the game; the server runs the exact same code
// to replay a submitted jump log and recompute the score, so a client-reported
// score is never trusted.
//
// Everything is in fixed world units (a HURDLES_W-wide stage, heights measured
// up from the floor), independent of how big the canvas is drawn. Changes made
// for determinism / fairness relative to a free-running browser game:
//   - every Math.random() is the seeded Rng
//   - Math.sin (UFO bob) is dsin
//   - the player hitbox is a FIXED cell (HURDLES_CELL), never the sprite's size
//   - no viewport-dependent speed or jump scaling

import { Rng, dsin } from './rng.js';
import { MAX_TICKS } from './hopper.js';

export type HurdlesDifficulty = 'fast' | 'faster';
export type HurdlesDeathCause = 'flower' | 'ufo';

/**
 * The recorded input log: the ticks at which jump was pressed, ascending.
 * A press at tick `t` is applied by the step that advances the sim from tick
 * `t` to `t + 1`.
 */
export type HurdlesInputLog = number[];

/**
 * Transient per-tick events — derived purely from the deterministic step and
 * with no bearing on the score. They exist so the renderer can trigger sound
 * and one-off messages without diffing state.
 */
export type HurdlesEvent = 'jump' | 'doubleJump' | 'ufoWarning';

export interface HurdlesReplayResult {
  score: number;
  ticks: number;
  died: boolean;
  deathCause: HurdlesDeathCause;
}

// ── Fixed world constants (canvas-independent) ─────────────────────────────
/** Stage width. Obstacles spawn just past the right edge. */
export const HURDLES_W = 680;
/** Left edge of the player's cell. */
export const HURDLES_PLAYER_X = 80;
/** Fixed player cell — identical for every character. The hitbox derives from it. */
export const HURDLES_CELL = 48;
/** Score from which UFOs start to appear. */
export const HURDLES_UFO_FROM = 200;

const TAU = 6.283185307179586;
const GRAVITY = 0.55;
const JUMP_V = -13;
const DOUBLE_JUMP_FACTOR = 0.85;
/** UFOs fly a touch faster than the floor scrolls. */
const UFO_VX = 1.15;
/** UFO art is 13×6 cells of 4 units. */
const UFO_W = 52;
const UFO_H = 24;
/** Flower art is 7×9 cells; the cell size varies per flower. */
const FLOWER_COLS = 7;
const FLOWER_ROWS = 9;
const FLOWER_P_MIN = 4;
const FLOWER_P_MAX = 7;
/** UFOs at or above this altitude are "overhead" ones: they bob more. */
const UFO_HIGH_ALT = 60;
/**
 * Furthest an obstacle may travel between collision checks. Less than the
 * narrowest player + obstacle overlap (~36 units), so nothing can pass
 * through the player unchecked however fast the run gets.
 */
const COLLISION_STEP = 16;

export interface HurdlesObstacle {
  kind: 'flower' | 'ufo';
  x: number;
  /** x one step ago — render-only, for drawing between steps. */
  prevX: number;
  w: number;
  h: number;
  /** Height of the obstacle's bottom above the floor (0 for flowers). */
  alt: number;
  /** Bob phase (UFOs only). */
  bob: number;
  /** Art cell size — render-only. */
  p: number;
}

export interface HurdlesState {
  /** Height of the player's feet above the floor. */
  y: number;
  /** y one step ago — render-only. */
  prevY: number;
  vy: number;
  grounded: boolean;
  /** Double jump already spent for this airtime. */
  dj: boolean;
  obs: HurdlesObstacle[];
  score: number;
  speed: number;
  /** Total distance the floor has scrolled — render-only. */
  scrolled: number;
  /** scrolled one step ago — render-only. */
  prevScrolled: number;
  spawnIn: number;
  ufoSeen: boolean;
  dead: boolean;
  deathCause: HurdlesDeathCause;
  tick: number;
}

interface DifficultyConfig {
  baseSpeed: number;
  /** Speed gains 1 unit/tick every `speedDiv` points. */
  speedDiv: number;
  initSpawnIn: number;
}

export function hurdlesDifficultyConfig(d: HurdlesDifficulty): DifficultyConfig {
  if (d === 'faster') return { baseSpeed: 11, speedDiv: 120, initSpawnIn: 60 };
  return { baseSpeed: 7.5, speedDiv: 200, initSpawnIn: 90 };
}

/**
 * Vertical bob of an obstacle at a given score. High fliers drift more so they
 * read as airborne; low ones stay predictable. Exported so the renderer draws
 * exactly what the collision check sees.
 */
export function hurdlesUfoBob(o: HurdlesObstacle, score: number): number {
  if (o.kind !== 'ufo') return 0;
  return dsin(score * 0.08 + o.bob) * (o.alt > UFO_HIGH_ALT ? 9 : 3);
}

export class HurdlesSim {
  readonly state: HurdlesState;
  /** Events from the most recent step() — render-only, cleared each step. */
  readonly events: HurdlesEvent[] = [];
  private readonly cfg: DifficultyConfig;
  private readonly rng: Rng;

  constructor(seed: number, difficulty: HurdlesDifficulty) {
    this.cfg = hurdlesDifficultyConfig(difficulty);
    this.rng = new Rng(seed);
    this.state = {
      y: 0,
      prevY: 0,
      vy: 0,
      grounded: true,
      dj: false,
      obs: [],
      score: 0,
      speed: this.cfg.baseSpeed,
      scrolled: 0,
      prevScrolled: 0,
      spawnIn: this.cfg.initSpawnIn,
      ufoSeen: false,
      dead: false,
      deathCause: 'flower',
      tick: 0,
    };
  }

  private makeFlower(x: number): HurdlesObstacle {
    const p = FLOWER_P_MIN + Math.floor(this.rng.next() * (FLOWER_P_MAX - FLOWER_P_MIN + 1));
    return {
      kind: 'flower',
      x,
      prevX: x,
      w: FLOWER_COLS * p,
      h: FLOWER_ROWS * p,
      alt: 0,
      bob: 0,
      p,
    };
  }

  private makeUfo(x: number, alt: number): HurdlesObstacle {
    return {
      kind: 'ufo',
      x,
      prevX: x,
      w: UFO_W,
      h: UFO_H,
      alt,
      bob: this.rng.next() * TAU,
      p: 4,
    };
  }

  /**
   * One spawn slot: a flower, or (past HURDLES_UFO_FROM) one of the UFO
   * patterns. Returns extra spacing to add before the next slot.
   *
   * The order of rng calls here is part of the replay contract — do not
   * reorder them or make the unconditional ones conditional.
   */
  private spawn(): number {
    const st = this.state;
    const x = HURDLES_W + 10;
    const ufoChance =
      st.score < HURDLES_UFO_FROM ? 0 : Math.min(0.5, 0.3 + (st.score - HURDLES_UFO_FROM) / 3000);
    if (this.rng.next() >= ufoChance) {
      st.obs.push(this.makeFlower(x));
      return 0;
    }

    if (!st.ufoSeen) {
      st.ufoSeen = true;
      this.events.push('ufoWarning');
    }
    const r = this.rng.next();
    if (r < 0.5) {
      // Combo: landing from the flower jump drops you right into the UFO, so
      // it has to be cleared with a double jump. The UFO is placed to *arrive*
      // at the player ~30–38 ticks after the flower, allowing for it flying
      // faster than the floor.
      const f = this.makeFlower(x);
      const lag = 30 + this.rng.next() * 8;
      const ux = HURDLES_PLAYER_X + UFO_VX * (x + f.w - HURDLES_PLAYER_X) + UFO_VX * st.speed * lag;
      const alt = 16 + this.rng.next() * 12;
      st.obs.push(f, this.makeUfo(ux, alt));
      return 36;
    }
    if (r < 0.75) {
      // Head height: jump it.
      const alt = 12 + this.rng.next() * 12;
      st.obs.push(this.makeUfo(x, alt));
    } else {
      // Overhead: stay grounded.
      const alt = 64 + this.rng.next() * 56;
      st.obs.push(this.makeUfo(x, alt));
    }
    return 16;
  }

  /** Advance the simulation one tick. Idempotent once dead. */
  step(jump: boolean): void {
    const st = this.state;
    const cfg = this.cfg;
    this.events.length = 0;
    if (st.dead) return;

    st.prevY = st.y;
    st.prevScrolled = st.scrolled;
    for (const o of st.obs) o.prevX = o.x;

    // ── Jump input ───────────────────────────────────────────────────────
    if (jump) {
      if (st.grounded) {
        st.vy = JUMP_V;
        st.grounded = false;
        st.dj = false;
        this.events.push('jump');
      } else if (!st.dj) {
        st.vy = JUMP_V * DOUBLE_JUMP_FACTOR;
        st.dj = true;
        this.events.push('doubleJump');
      }
    }

    // ── Vertical movement ────────────────────────────────────────────────
    if (!st.grounded) {
      st.vy += GRAVITY;
      st.y -= st.vy;
      if (st.y <= 0) {
        st.y = 0;
        st.vy = 0;
        st.grounded = true;
      }
    }

    // ── Score + pacing ───────────────────────────────────────────────────
    st.tick++;
    st.score++;
    st.speed = cfg.baseSpeed + st.score / cfg.speedDiv;
    st.scrolled += st.speed;

    st.spawnIn--;
    if (st.spawnIn <= 0) {
      const extra = this.spawn();
      // Never tighter than a jump → land → jump gap.
      st.spawnIn = Math.max(54, 92 - Math.floor(st.score / 150) * 6) + this.rng.next() * 40 + extra;
    }

    // ── Obstacle movement ────────────────────────────────────────────────
    for (const o of st.obs) o.x -= o.kind === 'ufo' ? st.speed * UFO_VX : st.speed;

    // ── Collision ────────────────────────────────────────────────────────
    // Heights are measured up from the floor. Flowers only need the lower
    // body to clear them; UFOs check the whole body so you can't head-butt
    // through one.
    //
    // Speed climbs for as long as a run lasts, so late on an obstacle moves
    // further in one tick than it is wide. Checking only where it ends up
    // would let it skip clean over the player; instead its path this tick is
    // checked every COLLISION_STEP units. Below that speed this is exactly
    // one check, at its final position.
    const hx = HURDLES_PLAYER_X + HURDLES_CELL * 0.3;
    const hw = HURDLES_CELL * 0.4;
    const feet = st.y;
    const head = feet + HURDLES_CELL * 0.78;
    for (const o of st.obs) {
      const moved = o.prevX - o.x;
      const checks = Math.max(1, Math.ceil(moved / COLLISION_STEP));
      let top: number;
      let bottom: number;
      let inset: number;
      if (o.kind === 'flower') {
        bottom = 0;
        top = o.h * 0.9;
        inset = 0.2;
      } else {
        const base = o.alt + hurdlesUfoBob(o, st.score);
        bottom = base + o.h * 0.1;
        top = base + o.h * 0.9;
        inset = 0.1;
      }
      // Flowers stand on the floor, so only the feet have to clear them.
      if (feet >= top || (o.kind === 'ufo' && head <= bottom)) continue;
      const ow = o.w * (1 - inset * 2);
      for (let c = 0; c < checks; c++) {
        const ox = o.x + (moved * c) / checks + o.w * inset;
        if (hx < ox + ow && hx + hw > ox) {
          st.dead = true;
          st.deathCause = o.kind;
          return;
        }
      }
    }

    // ── Cull ─────────────────────────────────────────────────────────────
    st.obs = st.obs.filter((o) => o.x > -80);
  }
}

/**
 * Headless replay used by the server. Steps a fresh sim through the jump log
 * and returns the authoritative score.
 */
export function simulateHurdles(
  seed: number,
  difficulty: HurdlesDifficulty,
  log: HurdlesInputLog,
  maxTicks: number = MAX_TICKS,
): HurdlesReplayResult {
  const sim = new HurdlesSim(seed, difficulty);
  let li = 0;
  for (let t = 0; t < maxTicks; t++) {
    let jump = false;
    while (li < log.length) {
      const jt = log[li];
      if (jt === undefined || jt > t) break;
      if (jt === t) jump = true;
      li++;
    }
    sim.step(jump);
    if (sim.state.dead) {
      return {
        score: sim.state.score,
        ticks: t + 1,
        died: true,
        deathCause: sim.state.deathCause,
      };
    }
  }
  return {
    score: sim.state.score,
    ticks: maxTicks,
    died: false,
    deathCause: sim.state.deathCause,
  };
}

// Deterministic jumper simulation.
//
// This is the authoritative game logic. The browser runs it to render the
// game; the server runs the exact same code to replay a submitted input log
// and recompute the score. Because both sides step the same deterministic
// sim from the same seed and inputs, the server never has to trust a
// client-reported score.
//
// Extracted verbatim from the original JumperEngine.step() physics. The only
// deliberate changes for determinism / fairness:
//   - every Math.random() is replaced by the seeded Rng
//   - Math.sin (alien bob) is replaced by dsin
//   - Math.pow(_, 2) is replaced by an explicit multiply
//   - the player hitbox is a FIXED size (PLAYER_W/PLAYER_H) rather than the
//     user-controlled sprite frame dimensions — the previous behaviour let
//     each character have a different hitbox, which is neither fair nor
//     reproducible server-side.

import { Rng, dsin } from './rng.js';

export type JumperDifficulty = 'fast' | 'faster';
export type DeathCause = 'fall' | 'alien' | 'blackhole';

/** Per-tick control state. */
export interface JumperInput {
  left: boolean;
  right: boolean;
}

/** A change event in the recorded input log: at tick `t`, input became l/r. */
export interface JumperInputEvent {
  t: number;
  l: boolean;
  r: boolean;
}

export type JumperInputLog = JumperInputEvent[];

/**
 * Transient per-tick events. These are derived purely from the deterministic
 * step (no RNG, no bearing on the score) and exist only so the renderer can
 * trigger sound effects without re-deriving game events from state diffs.
 */
export type JumperEvent = 'land' | 'spring' | 'crumble' | 'stomp' | 'jetpack';

export interface ReplayResult {
  score: number;
  ticks: number;
  died: boolean;
  deathCause: DeathCause;
}

// ── Fixed world constants (canvas-independent) ─────────────────────────────
const CW = 352;
const CH = 520;
const MAX_GAP = 170;
const JETPACK_DURATION = 210;
const BH_RADIUS = 20;
const BH_PULL_RADIUS = 100;

/** Fixed player hitbox — identical for every character. */
export const PLAYER_W = 16;
export const PLAYER_H = 16;

type PlatType = 'solid' | 'crumble' | 'moving';

export interface Plat {
  x: number;
  y: number;
  w: number;
  type: PlatType;
  dx: number;
  crumbleTimer: number;
  hasSpring: boolean;
}

export interface BlackHole {
  x: number;
  y: number;
  angle: number;
}

export interface Alien {
  x: number;
  y: number;
  dx: number;
  baseY: number;
  phase: number;
  amplitude: number;
  dyingTimer: number;
}

export interface JumperState {
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
  deathCause: DeathCause;
  tick: number;
  facing: 1 | -1;
}

interface DifficultyConfig {
  grav: number;
  bounce: number;
  walk: number;
  spring: number;
  jpack: number;
  initAlienAt: number;
  initBlackHoleAt: number;
}

export function difficultyConfig(d: JumperDifficulty): DifficultyConfig {
  if (d === 'faster') {
    return {
      grav: 0.38,
      bounce: -13.5,
      walk: 5.0,
      spring: -13.5 * 1.8,
      jpack: -5.0,
      initAlienAt: 1200,
      initBlackHoleAt: 5000,
    };
  }
  return {
    grav: 0.25,
    bounce: -10.5,
    walk: 3.5,
    spring: -10.5 * 2,
    jpack: -3.5,
    initAlienAt: 2000,
    initBlackHoleAt: 8000,
  };
}

export class JumperSim {
  readonly state: JumperState;
  /** Events from the most recent step() — render-only, cleared each step. */
  readonly events: JumperEvent[] = [];
  private readonly cfg: DifficultyConfig;
  private readonly rng: Rng;

  constructor(seed: number, difficulty: JumperDifficulty) {
    this.cfg = difficultyConfig(difficulty);
    this.rng = new Rng(seed);
    this.state = {
      px: CW / 2,
      py: CH - 44 - PLAYER_H,
      pvx: 0,
      pvy: this.cfg.bounce,
      plats: this.initPlats(),
      aliens: [],
      nextAlienAt: this.cfg.initAlienAt,
      blackHoles: [],
      nextBlackHoleAt: this.cfg.initBlackHoleAt,
      jetpackPickup: null,
      nextJetpackAt: 5000,
      jetpackFrames: 0,
      scrolled: 0,
      score: 0,
      dead: false,
      deathCause: 'fall',
      tick: 0,
      facing: 1,
    };
  }

  private makePlat(x: number, y: number, w: number, type: PlatType, hasSpring = false): Plat {
    // Order of rng calls must match the original Math.random ordering exactly.
    const dx =
      type === 'moving' ? (this.rng.next() > 0.5 ? 1 : -1) * (0.7 + this.rng.next() * 0.9) : 0;
    return { x, y, w, type, hasSpring, dx, crumbleTimer: -1 };
  }

  private initPlats(): Plat[] {
    const plats: Plat[] = [];
    plats.push(this.makePlat(CW / 2 - 32, CH - 44, 64, 'solid'));
    let y = CH - 44 - 100;
    while (y > CH * 0.1) {
      const w = 44 + this.rng.next() * 16;
      const x = 8 + this.rng.next() * (CW - w - 16);
      plats.push(this.makePlat(x, y, w, 'solid'));
      y -= 95 + this.rng.next() * 35;
    }
    return plats;
  }

  private generatePlatforms(topY: number, bottomY: number, scrolled: number): Plat[] {
    const plats: Plat[] = [];
    const diff = Math.min(2, scrolled / 2000);
    let y = bottomY;
    let prevType: PlatType = 'solid';
    while (y > topY) {
      const w = Math.max(30, 68 - diff * 18 + this.rng.next() * 14);
      const x = 8 + this.rng.next() * (CW - w - 16);
      const r = this.rng.next();
      let type: PlatType = 'solid';
      if (prevType === 'solid') {
        if (diff > 0.4 && r > 0.82) type = 'crumble';
        else if (diff > 0.7 && r > 0.74) type = 'moving';
      }
      // hasSpring's rng call only fires for solid platforms — preserve that.
      const hasSpring = type === 'solid' && this.rng.next() < 0.07;
      plats.push(this.makePlat(x, y, w, type, hasSpring));
      prevType = type;
      y -= Math.min(MAX_GAP, 95 + diff * 55 + this.rng.next() * 25);
    }
    return plats;
  }

  /** Advance the simulation one tick. Idempotent once dead. */
  step(input: JumperInput): void {
    const st = this.state;
    const cfg = this.cfg;
    this.events.length = 0;
    if (st.dead) return;
    st.tick++;

    // ── Horizontal movement ──────────────────────────────────────────────
    if (input.left) {
      st.pvx = -cfg.walk;
      st.facing = -1;
    } else if (input.right) {
      st.pvx = cfg.walk;
      st.facing = 1;
    } else {
      st.pvx *= 0.8;
    }
    st.px += st.pvx;
    if (st.px < -PLAYER_W / 2) st.px = CW + PLAYER_W / 2;
    if (st.px > CW + PLAYER_W / 2) st.px = -PLAYER_W / 2;

    // ── Vertical movement ────────────────────────────────────────────────
    if (st.jetpackFrames > 0) {
      st.pvy = cfg.jpack;
    } else {
      st.pvy += cfg.grav;
      if (st.pvy > 18) st.pvy = 18;
    }
    st.py += st.pvy;

    const playerBottom = st.py + PLAYER_H;
    const playerLeft = st.px - PLAYER_W * 0.28;
    const playerRight = st.px + PLAYER_W * 0.28;

    // ── Platform landing ─────────────────────────────────────────────────
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
            st.pvy = cfg.bounce;
            st.py = p.y - PLAYER_H;
            this.events.push('crumble');
          } else {
            st.pvy = p.hasSpring ? cfg.spring : cfg.bounce;
            st.py = p.y - PLAYER_H;
            this.events.push(p.hasSpring ? 'spring' : 'land');
          }
          break;
        }
      }
    }

    // ── Alien movement + spawn ───────────────────────────────────────────
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
      al.y = al.baseY + dsin(al.phase) * al.amplitude;
      if (al.x < -20) al.dx = Math.abs(al.dx);
      if (al.x > CW + 4) al.dx = -Math.abs(al.dx);
    }
    if (st.scrolled >= st.nextAlienAt && alienDiff > 0.3) {
      const fromLeft = this.rng.next() > 0.5;
      const spawnY = CH * 0.15 + this.rng.next() * CH * 0.55;
      st.aliens.push({
        x: fromLeft ? -16 : CW + 16,
        y: spawnY,
        baseY: spawnY,
        dx: (fromLeft ? 1 : -1) * (0.6 + alienDiff * 0.5 + this.rng.next() * 0.4),
        phase: this.rng.next() * Math.PI * 2,
        amplitude: 20 + this.rng.next() * 30,
        dyingTimer: 0,
      });
      st.nextAlienAt += Math.max(800, 1600 - alienDiff * 400);
    }

    // ── Jetpack pickup ───────────────────────────────────────────────────
    if (st.jetpackFrames > 0) st.jetpackFrames--;
    if (st.scrolled >= st.nextJetpackAt && !st.jetpackPickup) {
      const candidates = st.plats.filter(
        (p) => p.y < -20 && p.y > -CH * 2 && p.type === 'solid' && !p.hasSpring,
      );
      const host = candidates[Math.floor(this.rng.next() * candidates.length)];
      if (host) {
        st.jetpackPickup = { x: host.x + host.w / 2 - 14, y: host.y - 28 };
        st.nextJetpackAt += 6000 + this.rng.next() * 2000;
      }
    }
    if (st.jetpackPickup) {
      if (st.jetpackPickup.y > CH + 40) {
        st.jetpackPickup = null;
      } else {
        const jp = st.jetpackPickup;
        if (
          st.px + PLAYER_W * 0.4 > jp.x &&
          st.px - PLAYER_W * 0.4 < jp.x + 28 &&
          st.py + PLAYER_H > jp.y &&
          st.py < jp.y + 28
        ) {
          st.jetpackFrames = JETPACK_DURATION;
          st.jetpackPickup = null;
          this.events.push('jetpack');
        }
      }
    }
    st.aliens = st.aliens.filter(
      (al) => al.dyingTimer !== -1 && (al.dyingTimer > 0 || al.y < CH + 40),
    );

    // ── Black holes ──────────────────────────────────────────────────────
    if (st.scrolled >= st.nextBlackHoleAt) {
      st.blackHoles.push({ x: 35 + this.rng.next() * (CW - 70), y: -CH * 0.5, angle: 0 });
      st.nextBlackHoleAt += 6000 + this.rng.next() * 4000;
    }
    for (const bh of st.blackHoles) {
      bh.angle += 0.025;
      const bdx = bh.x - st.px;
      const bdy = bh.y - (st.py + PLAYER_H / 2);
      const dist = Math.sqrt(bdx * bdx + bdy * bdy);
      if (dist < BH_RADIUS) {
        st.dead = true;
        st.deathCause = 'blackhole';
        break;
      } else if (dist < BH_PULL_RADIUS) {
        const falloff = 1 - dist / BH_PULL_RADIUS;
        const pull = 1.2 * falloff * falloff;
        st.pvx += (bdx / dist) * pull;
        st.pvy += (bdy / dist) * pull;
      }
    }
    st.blackHoles = st.blackHoles.filter((bh) => bh.y < CH + 60);
    // Death score freezes at the value from the previous camera scroll —
    // returning early here keeps that behaviour and skips no-op work.
    if (st.dead) return;

    // ── Alien collision ──────────────────────────────────────────────────
    for (const al of st.aliens) {
      if (al.dyingTimer !== 0) continue;
      if (!(st.px + PLAYER_W * 0.28 > al.x + 6 && st.px - PLAYER_W * 0.28 < al.x + 42)) continue;
      if (!(playerBottom > al.y + 8 && st.py < al.y + 44)) continue;
      if (st.pvy > 0 && playerBottom - (al.y + 8) < 20) {
        al.dyingTimer = 22;
        st.pvy = cfg.bounce;
        st.py = al.y + 8 - PLAYER_H;
        this.events.push('stomp');
      } else {
        st.dead = true;
        st.deathCause = 'alien';
        break;
      }
    }
    if (st.dead) return;

    // ── Platform updates ─────────────────────────────────────────────────
    for (const p of st.plats) {
      if (p.crumbleTimer > 0) {
        p.crumbleTimer--;
        if (p.crumbleTimer === 0) p.crumbleTimer = -200;
      } else if (p.crumbleTimer < -1) {
        p.crumbleTimer++;
      }
      if (p.type === 'moving') {
        p.x += p.dx;
        if (p.x < 0 || p.x + p.w > CW) p.dx *= -1;
      }
    }

    // ── Camera scroll → score ────────────────────────────────────────────
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
    }

    // ── Cull + generate ──────────────────────────────────────────────────
    st.plats = st.plats.filter((p) => p.y < CH + 20);
    const topmost = st.plats.length ? Math.min(...st.plats.map((p) => p.y)) : CH;
    if (topmost > -CH) {
      st.plats.push(...this.generatePlatforms(-3000, topmost - 130, st.scrolled));
    }

    // ── Fall death ───────────────────────────────────────────────────────
    if (st.py > CH + 20) {
      st.dead = true;
      st.deathCause = 'fall';
    }
  }
}

/** Hard cap on replay length (~60 min at 60fps) — bounds server work. */
export const MAX_TICKS = 216000;

/**
 * Headless replay used by the server. Steps a fresh sim through the input
 * log and returns the authoritative score.
 */
export function simulate(
  seed: number,
  difficulty: JumperDifficulty,
  log: JumperInputLog,
  maxTicks: number = MAX_TICKS,
): ReplayResult {
  const sim = new JumperSim(seed, difficulty);
  let li = 0;
  const cur: JumperInput = { left: false, right: false };
  for (let t = 0; t < maxTicks; t++) {
    while (li < log.length) {
      const ev = log[li];
      if (!ev || ev.t > t) break;
      cur.left = ev.l;
      cur.right = ev.r;
      li++;
    }
    sim.step(cur);
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

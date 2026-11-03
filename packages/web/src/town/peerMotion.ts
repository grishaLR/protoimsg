/**
 * Smooth motion for other people's avatars.
 *
 * Moves reach us in batches (the server's area-of-interest view tick), so the
 * gaps between arrivals are uneven even though the mover sent them evenly.
 * Chasing the newest position on arrival turns that unevenness into surging
 * and dragging. Instead each fresh move carries when the server received it
 * (`t`), and peers are replayed a little in the past, gliding at a steady
 * speed between the two samples around the playback time.
 *
 * Local time here is monotonic (`performance.now()`): a wall-clock jump must
 * never throw playback off. The server→local offset absorbs the difference.
 */

/**
 * How far behind real time peers are shown. Must cover a send interval
 * (~120 ms) plus the server's batching wait (up to ~100 ms), so the next
 * sample is almost always in hand before playback reaches it.
 */
export const PEER_DELAY_MS = 250;
/** Roughly how often a walking client sends its position (110 ms throttle). */
const SEND_INTERVAL_MS = 120;
/** A gap longer than this since the last sample means they were standing still. */
const REST_GAP_MS = 300;
/** Keep the walk cycle going this long past the last sample (a late packet). */
const LATE_GRACE_MS = 120;
/** How fast the clock estimate relaxes when delivery gets slower (ms per ms). */
const CLOCK_RELAX = 0.02;
/**
 * Clock corrections are eased in: playback runs at most this much faster or
 * slower than real time while catching up, so a correction never shows as a
 * jump.
 */
const CLOCK_SLEW = 0.1;
/** A correction bigger than this is applied at once (easing would take ages). */
const CLOCK_SNAP_MS = 1_000;
const MAX_SAMPLES = 16;

export interface PeerSample {
  /** Server time this position was received (estimated, if `provisional`). */
  t: number;
  x: number;
  y: number;
  dir: number;
  /** Walk-cycle speed multiplier (sprinting is faster). */
  pace: number;
  /**
   * Not server-stamped (someone standing still, or an older server): its time
   * is our estimate, so a real stamp may re-time it rather than be dropped.
   */
  provisional?: boolean;
  /** Arrived here by teleport (a door, a respawn): jump, don't glide. */
  jump?: boolean;
}

export interface PeerPose {
  x: number;
  y: number;
  dir: number;
  pace: number;
  moving: boolean;
}

/**
 * Maps server time to local time. The offset is the quickest delivery seen
 * (local arrival − server stamp — network delay plus clock difference); it
 * relaxes slowly upwards so a lasting slowdown is absorbed instead of
 * starving playback. Only real stamps move it.
 */
export class PeerClock {
  private offset: number | null = null;
  private lastObserved = 0;
  /** The offset playback actually uses, eased toward `offset`. */
  private eased: number | null = null;
  private lastPlayback = 0;

  /** Server time now, by the current estimate (local time until a stamp is seen). */
  serverNow(localNow: number): number {
    return localNow - (this.offset ?? 0);
  }

  /** A server-stamped sample arrived. */
  observe(t: number, localNow: number): void {
    const seen = localNow - t;
    if (this.offset === null) {
      this.offset = seen;
    } else {
      const relaxed = this.offset + Math.max(0, localNow - this.lastObserved) * CLOCK_RELAX;
      this.offset = Math.min(relaxed, seen);
    }
    this.lastObserved = localNow;
  }

  /** The server time to show peers at, now. */
  playbackTime(localNow: number): number {
    const target = this.offset;
    if (target === null) {
      // No stamp yet: nothing to ease from. Start fresh at the first one.
      this.lastPlayback = localNow;
      return localNow - PEER_DELAY_MS;
    }
    if (this.eased === null) {
      this.eased = target;
    } else {
      const gap = target - this.eased;
      const room = Math.max(0, localNow - this.lastPlayback) * CLOCK_SLEW;
      this.eased =
        Math.abs(gap) > CLOCK_SNAP_MS ? target : this.eased + Math.max(-room, Math.min(room, gap));
    }
    this.lastPlayback = localNow;
    return localNow - this.eased - PEER_DELAY_MS;
  }
}

/** One peer's recent positions, replayed at a steady speed. */
export class PeerTrack {
  private samples: PeerSample[];
  private wasMoving = false;

  constructor(
    first: PeerSample,
    /** A step longer than this is a teleport: jump there. */
    private readonly snapDist: number,
    /** Their walking speed (px/s, before `pace`): how long a step took. */
    private readonly walkSpeed: number,
  ) {
    this.samples = [{ ...first }];
  }

  /** The newest sample's time: playback is done with them past this. */
  get lastTime(): number {
    return this.samples[this.samples.length - 1]?.t ?? -Infinity;
  }

  push(next: PeerSample): void {
    const s = { ...next };
    let last = this.samples[this.samples.length - 1];
    if (!last) {
      this.samples = [s];
      return;
    }
    // A guessed time can't outrank a real stamp: re-time the guess to just
    // before it, as a resting spot (it was someone standing still).
    if (last.provisional && !s.provisional && s.t <= last.t) {
      last = { ...last, t: s.t - SEND_INTERVAL_MS, provisional: false };
      this.samples = [last];
    }
    if (s.t < last.t) return; // older than what we have: ignore
    if (s.t === last.t) {
      Object.assign(last, s);
      return;
    }
    const step = Math.hypot(s.x - last.x, s.y - last.y);
    if (step > this.snapDist) {
      // Walk up to where they were, then jump.
      s.jump = true;
    } else if (s.t - last.t > REST_GAP_MS) {
      // They stood still until just before this move: hold the old spot
      // until then, and take the step at walking pace — not creep across the
      // idle gap, or shuffle a tiny first step out over a whole send interval.
      const took = Math.min(SEND_INTERVAL_MS, (step / (this.walkSpeed * s.pace)) * 1000);
      this.samples.push({ ...last, t: s.t - Math.max(1, took), jump: false });
    }
    this.samples.push(s);
    if (this.samples.length > MAX_SAMPLES) {
      this.samples.splice(0, this.samples.length - MAX_SAMPLES);
    }
  }

  /** Where they are at server time `t` (samples before it are dropped). */
  at(t: number): PeerPose {
    const s = this.samples;
    while (s.length >= 2 && (s[1]?.t ?? Infinity) <= t) s.shift();
    const a = s[0];
    const b = s[1];
    if (!a) return { x: 0, y: 0, dir: 0, pace: 1, moving: false };
    if (!b || t <= a.t || b.jump) {
      // Holding at a sample: past the newest one, before the first, or at a
      // teleport's take-off. Keep walking briefly if the next one is merely
      // late, then stand.
      const moving = !b?.jump && this.wasMoving && t > a.t && t - a.t < LATE_GRACE_MS;
      if (!moving) this.wasMoving = false;
      return { x: a.x, y: a.y, dir: a.dir, pace: a.pace, moving };
    }
    const f = (t - a.t) / (b.t - a.t);
    const moving = Math.hypot(b.x - a.x, b.y - a.y) > 0.5;
    this.wasMoving = moving;
    return {
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      dir: moving ? b.dir : a.dir,
      pace: b.pace,
      moving,
    };
  }
}

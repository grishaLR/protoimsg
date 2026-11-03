import { describe, expect, it } from 'vitest';
import { PEER_DELAY_MS, PeerClock, PeerTrack, type PeerPose } from './peerMotion';

const SPEED = 132; // px/s, as in WorldEngine
const SEND_MS = 117; // 110 ms throttle, rounded up to whole 60 fps frames
const FRAME_MS = 1000 / 60;
const SNAP = 240;

/** Small seeded PRNG so the jitter is the same on every run. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

interface Arrival {
  /** Local time it reaches the viewer. */
  at: number;
  t: number;
  x: number;
}

/**
 * A peer walking right for `walkMs`, sending every SEND_MS. The server stamps
 * each move on receipt (send + ~20 ms network), then holds it 0–100 ms in its
 * batch; the viewer gets it ~20 ms later. The viewer's clock runs `skew` ms
 * apart from the server's.
 */
function walk(walkMs: number, seed: number, skew = 5_000): Arrival[] {
  const rand = rng(seed);
  const out: Arrival[] = [];
  for (let sent = 0; sent <= walkMs; sent += SEND_MS) {
    const t = 1_000_000 + sent + 15 + rand() * 10;
    const at = t + skew + rand() * 100 + 15 + rand() * 10;
    out.push({ at, t, x: (SPEED * sent) / 1000 });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Render at 60 fps from the first arrival until `untilMs` later. */
function play(arrivals: Arrival[], untilMs: number, stampless = false): PeerPose[] {
  const clock = new PeerClock();
  let track: PeerTrack | null = null;
  const poses: PeerPose[] = [];
  const first = arrivals[0]?.at ?? 0;
  let next = 0;
  // Frames run before anyone shows up too: the engine ticks the clock always.
  for (let now = first - 500; now <= first + untilMs; now += FRAME_MS) {
    while (next < arrivals.length && (arrivals[next]?.at ?? Infinity) <= now) {
      const a = arrivals[next++];
      if (!a) break;
      // As the engine does: real stamps move the clock; without one, guess.
      let sample;
      if (stampless) {
        sample = { t: clock.serverNow(a.at), x: a.x, y: 0, dir: 0, pace: 1, provisional: true };
      } else {
        clock.observe(a.t, a.at);
        sample = { t: a.t, x: a.x, y: 0, dir: 0, pace: 1 };
      }
      if (track) track.push(sample);
      else track = new PeerTrack(sample, SNAP, SPEED);
    }
    const playback = clock.playbackTime(now);
    if (track && now >= first) poses.push(track.at(playback));
  }
  return poses;
}

/** Per-frame speeds (px/s) while the peer is mid-walk. */
function speeds(poses: PeerPose[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < poses.length; i++) {
    const a = poses[i - 1];
    const b = poses[i];
    if (a && b && a.moving && b.moving) out.push((Math.abs(b.x - a.x) * 1000) / FRAME_MS);
  }
  return out;
}

describe('peer motion', () => {
  it('walks at a steady speed despite uneven batched arrivals', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const poses = play(walk(3_000, seed), 3_000);
      const mid = speeds(poses).slice(10, -10);
      expect(mid.length).toBeGreaterThan(100);
      for (const v of mid) {
        expect(v).toBeGreaterThan(SPEED * 0.75);
        expect(v).toBeLessThan(SPEED * 1.25);
      }
    }
  });

  it('never drops to the standing frame mid-walk', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const poses = play(walk(3_000, seed), 3_000);
      // From when playback reaches the walk until just before it ends.
      const start = Math.ceil((PEER_DELAY_MS + 150) / FRAME_MS);
      const end = Math.floor((2_800 - 150) / FRAME_MS);
      const mid = poses.slice(start, end);
      expect(mid.every((p) => p.moving)).toBe(true);
    }
  });

  it('stops where they stopped, and stands', () => {
    const arrivals = walk(1_000, 7);
    const poses = play(arrivals, 2_000);
    const last = poses.at(-1);
    const finalX = Math.max(...arrivals.map((a) => a.x));
    expect(last?.x).toBeCloseTo(finalX, 5);
    expect(last?.moving).toBe(false);
  });

  it('starts walking promptly after standing still, without creeping', () => {
    const clock = new PeerClock();
    const track = new PeerTrack({ t: 0, x: 0, y: 0, dir: 0, pace: 1 }, SNAP, SPEED);
    clock.observe(0, 0);
    // Ten seconds later they take one step.
    track.push({ t: 10_000, x: 15, y: 0, dir: 0, pace: 1 });
    clock.observe(10_000, 10_000);
    // Just before the step's segment: still at the old spot.
    expect(track.at(10_000 - 130).x).toBe(0);
    // Mid-segment: moving at walk speed (15 px over ~120 ms), not 15 px over 10 s.
    const mid = track.at(10_000 - 60);
    expect(mid.moving).toBe(true);
    expect(mid.x).toBeGreaterThan(5);
  });

  it('walks up to a teleport (a door), then jumps rather than glides', () => {
    const track = new PeerTrack({ t: 0, x: 0, y: 0, dir: 0, pace: 1 }, SNAP, SPEED);
    track.push({ t: 100, x: 13, y: 0, dir: 0, pace: 1 });
    track.push({ t: 200, x: 1_000, y: 0, dir: 0, pace: 1 });
    expect(track.at(50).x).toBeCloseTo(6.5, 5); // still walking to the door
    expect(track.at(150).x).toBe(13); // at the door
    expect(track.at(200).x).toBe(1_000); // through it
  });

  it('first step after standing still plays at walking pace, not a shuffle', () => {
    const track = new PeerTrack({ t: 0, x: 0, y: 0, dir: 0, pace: 1 }, SNAP, SPEED);
    // The first send after rest goes out at once, with only a couple of pixels.
    track.push({ t: 10_000, x: 2, y: 0, dir: 0, pace: 1 });
    track.push({ t: 10_117, x: 2 + (SPEED * 117) / 1000, y: 0, dir: 0, pace: 1 });
    // Playback only moves forward: read the earlier time first.
    const before = track.at(10_000 - 10).x;
    const v1 = (track.at(10_000).x - before) / 10; // px per ms
    expect(v1 * 1000).toBeGreaterThan(SPEED * 0.75);
    expect(v1 * 1000).toBeLessThan(SPEED * 1.25);
  });

  it("doesn't freeze someone first seen standing still while our clock runs ahead", () => {
    const skew = 3_000; // our clock is 3 s ahead of the server's
    const clock = new PeerClock();
    // They're standing still when we arrive: no stamp, so we guess (and guess
    // with local time, since no stamp has been seen yet).
    const track = new PeerTrack(
      { t: clock.serverNow(1_000 + skew), x: 0, y: 0, dir: 0, pace: 1, provisional: true },
      SNAP,
      SPEED,
    );
    // A second later they walk; real stamps now arrive.
    let x = 0;
    for (let i = 0; i <= 10; i++) {
      const t = 2_000 + i * SEND_MS;
      x = (SPEED * i * SEND_MS) / 1000;
      clock.observe(t, t + skew + 30);
      track.push({ t, x, y: 0, dir: 0, pace: 1 });
    }
    // Mid-walk, playback must be moving them — not stuck at 0.
    const mid = track.at(2_000 + 5.5 * SEND_MS);
    expect(mid.moving).toBe(true);
    expect(mid.x).toBeGreaterThan(10);
  });

  it('ignores samples older than the newest it has', () => {
    const track = new PeerTrack({ t: 100, x: 10, y: 0, dir: 0, pace: 1 }, SNAP, SPEED);
    track.push({ t: 50, x: 99, y: 0, dir: 0, pace: 1 });
    expect(track.at(200).x).toBe(10);
  });

  it('places unstamped samples by the clock estimate without moving it', () => {
    const clock = new PeerClock();
    clock.observe(1_000, 6_000); // server is 5 s behind our clock
    expect(clock.serverNow(6_500)).toBe(1_500);
    expect(clock.playbackTime(6_500)).toBe(1_500 - PEER_DELAY_MS);
  });

  it('applies a large clock correction at once instead of easing for ages', () => {
    const clock = new PeerClock();
    clock.observe(0, 3_000); // a slow first packet: 3 s
    clock.playbackTime(3_000);
    clock.observe(3_100, 3_200); // the real delay: 100 ms
    expect(clock.playbackTime(3_216)).toBeCloseTo(3_216 - 100 - PEER_DELAY_MS, 5);
  });

  it('still smooths a server without stamps (arrival times only)', () => {
    const poses = play(walk(3_000, 9), 3_000, true);
    const start = Math.ceil((PEER_DELAY_MS + 150) / FRAME_MS);
    const end = Math.floor((2_800 - 150) / FRAME_MS);
    expect(poses.slice(start, end).every((p) => p.moving)).toBe(true);
  });
});

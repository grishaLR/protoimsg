import { describe, it, expect } from 'vitest';
import { Rng, dsin } from './rng.js';
import { JumperSim, simulate, type JumperInputLog, type JumperInput } from './jumper.js';

// These tests lock the determinism the anti-cheat depends on: the server
// must compute exactly the same score the player's browser did. If any of
// these golden values drift, client and server replay have diverged.

describe('Rng', () => {
  it('produces a fixed stream for a given seed', () => {
    const rng = new Rng(12345);
    const stream = Array.from({ length: 6 }, () => rng.next());
    expect(stream).toEqual([
      0.9797282677609473, 0.3067522644996643, 0.484205421525985, 0.817934412509203,
      0.5094283693470061, 0.34747186047025025,
    ]);
  });

  it('is reproducible — two instances of the same seed agree', () => {
    const a = new Rng(99);
    const b = new Rng(99);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
});

describe('dsin', () => {
  it('approximates sine within 1% and is engine-independent', () => {
    expect(dsin(0)).toBeCloseTo(0, 2);
    expect(dsin(Math.PI / 2)).toBeCloseTo(1, 2);
    expect(dsin(Math.PI)).toBeCloseTo(0, 2);
    expect(dsin(-Math.PI / 2)).toBeCloseTo(-1, 2);
  });
});

describe('simulate', () => {
  const log: JumperInputLog = [
    { t: 30, l: false, r: true },
    { t: 90, l: false, r: false },
    { t: 150, l: true, r: false },
    { t: 240, l: false, r: false },
  ];

  it('matches golden replay values (fast)', () => {
    expect(simulate(424242, 'fast', log)).toEqual({
      score: 0,
      ticks: 91,
      died: true,
      deathCause: 'fall',
    });
  });

  it('matches golden replay values (faster)', () => {
    expect(simulate(424242, 'faster', log)).toEqual({
      score: 0,
      ticks: 76,
      died: true,
      deathCause: 'fall',
    });
  });

  it('is deterministic — identical seed + log yields identical result', () => {
    for (const seed of [1, 777, 0xdeadbeef]) {
      expect(simulate(seed, 'fast', log)).toEqual(simulate(seed, 'fast', log));
    }
  });

  it('server replay matches a live tick-by-tick playthrough', () => {
    // Drive a sim exactly as JumperEngine does — recording a change-event
    // whenever input flips — then replay the recorded log and compare.
    const script = (t: number): JumperInput => ({
      left: Math.floor(t / 37) % 3 === 1,
      right: Math.floor(t / 37) % 3 === 2,
    });
    for (const seed of [5, 50, 500]) {
      const sim = new JumperSim(seed, 'fast');
      const recorded: JumperInputLog = [];
      let prev: JumperInput = { left: false, right: false };
      for (let t = 0; t < 6000 && !sim.state.dead; t++) {
        const input = script(t);
        if (input.left !== prev.left || input.right !== prev.right) {
          recorded.push({ t: sim.state.tick, l: input.left, r: input.right });
          prev = input;
        }
        sim.step(input);
      }
      const replay = simulate(seed, 'fast', recorded);
      expect(replay.score).toBe(sim.state.score);
      expect(replay.ticks).toBe(sim.state.tick);
    }
  });
});

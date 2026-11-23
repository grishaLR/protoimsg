import { describe, it, expect } from 'vitest';
import { HurdlesSim, simulateHurdles, type HurdlesInputLog } from './hurdles.js';

// These tests lock the determinism the anti-cheat depends on: the server must
// compute exactly the same score the player's browser did. If any of these
// golden values drift, client and server replay have diverged — and every
// in-flight run would be scored differently from what the player saw.

describe('simulateHurdles', () => {
  // Jump logs that carry a run well past the point where UFOs appear, so the
  // goldens cover flowers, all three UFO patterns and the double jump.
  const fastLog: HurdlesInputLog = [
    158, 253, 352, 478, 584, 626, 701, 779, 892, 962, 1093, 1148, 1379, 1468,
  ];
  const fasterLog: HurdlesInputLog = [
    106, 202, 304, 435, 541, 583, 659, 738, 851, 922, 1059, 1116, 1349, 1438,
  ];

  it('matches golden replay values (fast)', () => {
    expect(simulateHurdles(424242, 'fast', fastLog)).toEqual({
      score: 1638,
      ticks: 1638,
      died: true,
      deathCause: 'flower',
    });
  });

  it('matches golden replay values (faster)', () => {
    expect(simulateHurdles(424242, 'faster', fasterLog)).toEqual({
      score: 1609,
      ticks: 1609,
      died: true,
      deathCause: 'flower',
    });
  });

  it('matches golden replay values for a run with no input', () => {
    expect(simulateHurdles(424242, 'fast', [])).toEqual({
      score: 161,
      ticks: 161,
      died: true,
      deathCause: 'flower',
    });
  });

  it('is deterministic — identical seed + log yields identical result', () => {
    for (const seed of [1, 777, 0xdeadbeef]) {
      expect(simulateHurdles(seed, 'fast', fastLog)).toEqual(
        simulateHurdles(seed, 'fast', fastLog),
      );
    }
  });

  it('scores one point per tick survived', () => {
    const result = simulateHurdles(9, 'fast', fastLog);
    expect(result.score).toBe(result.ticks);
  });

  it('reports a run that outlives the tick cap as not died', () => {
    expect(simulateHurdles(424242, 'fast', [], 100)).toEqual({
      score: 100,
      ticks: 100,
      died: false,
      deathCause: 'flower',
    });
  });

  it('ignores a press that can do nothing (double jump already spent)', () => {
    // 158 jumps, 170 double-jumps, 175 is a third press in the same airtime.
    const withExtra = simulateHurdles(424242, 'fast', [158, 170, 175]);
    const without = simulateHurdles(424242, 'fast', [158, 170]);
    expect(withExtra).toEqual(without);
  });

  it('never lets an obstacle skip over the player, however fast the run gets', () => {
    // Late in a run an obstacle moves further per tick than it is wide. A
    // grounded player standing in its path must still be hit — at every
    // speed, and wherever in the tick the obstacle happens to cross.
    for (const score of [0, 3000, 6000, 12000, 30000, 100000]) {
      for (let offset = 0; offset < 40; offset++) {
        const sim = new HurdlesSim(1, 'fast');
        const st = sim.state;
        st.score = score;
        st.spawnIn = 1e9; // nothing else spawns
        const x = 690 + offset * 7.3;
        st.obs.push({ kind: 'flower', x, prevX: x, w: 28, h: 36, alt: 0, bob: 0, p: 4 });
        for (let t = 0; t < 400 && !st.dead && st.obs.length > 0; t++) sim.step(false);
        expect(st.dead, `score ${score}, offset ${offset}`).toBe(true);
        expect(st.deathCause).toBe('flower');
      }
    }
  });

  it('server replay matches a live tick-by-tick playthrough', () => {
    // Drive a sim exactly as HurdlesEngine does — recording the tick of every
    // jump press — then replay the recorded log and compare.
    const press = (t: number): boolean => t % 53 === 0 || t % 131 === 7;
    for (const difficulty of ['fast', 'faster'] as const) {
      for (const seed of [5, 50, 500]) {
        const sim = new HurdlesSim(seed, difficulty);
        const recorded: HurdlesInputLog = [];
        for (let t = 0; t < 6000 && !sim.state.dead; t++) {
          const jump = press(t);
          if (jump) recorded.push(sim.state.tick);
          sim.step(jump);
        }
        const replay = simulateHurdles(seed, difficulty, recorded);
        expect(replay.score).toBe(sim.state.score);
        expect(replay.ticks).toBe(sim.state.tick);
        expect(replay.deathCause).toBe(sim.state.deathCause);
      }
    }
  });
});

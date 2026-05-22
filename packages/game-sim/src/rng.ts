// Deterministic primitives shared by client and server replay.
//
// Everything here must produce bit-identical results on any JS engine
// (V8, JavaScriptCore, SpiderMonkey). That rules out Math.random and the
// transcendental Math functions (sin/cos/pow/exp/log), which are only
// "implementation-defined" in the spec. Plain +-*/, Math.floor/round/abs,
// Math.imul and Math.sqrt ARE specified to be correctly rounded, so those
// are safe to use.

const TAU = 6.283185307179586;
const PI = 3.141592653589793;

/**
 * mulberry32 — a tiny deterministic PRNG seeded by a uint32. Pure integer
 * math plus one float divide, so the stream is identical everywhere.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

/** Crypto-free uint32 seed generator for issuing fresh runs server-side. */
export function makeSeed(): number {
  return (Math.floor(Math.random() * 0x100000000) ^ Date.now()) >>> 0;
}

/**
 * Deterministic sine approximation (Bhaskara-style, ~0.1% error). Uses only
 * exactly-rounded operations, so it agrees across JS engines — unlike
 * Math.sin. Accuracy is irrelevant here; reproducibility is the point.
 */
export function dsin(x: number): number {
  // Reduce to [-PI, PI].
  let r = x - Math.floor(x / TAU) * TAU;
  if (r > PI) r -= TAU;
  const B = 1.2732395447351628; // 4 / PI
  const C = -0.4052847345693511; // -4 / (PI * PI)
  const y = B * r + C * r * Math.abs(r);
  // Precision refinement pass.
  return 0.225 * (y * Math.abs(y) - y) + y;
}

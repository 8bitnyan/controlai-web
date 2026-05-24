import type { SensorConfig } from '@controlai-web/shared-types';

/**
 * Mulberry32 — fast seeded PRNG returning floats in [0, 1).
 */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Box–Muller transform: produce a standard normal sample from two uniform(0,1) values.
 */
function gaussianFromUniform(u1: number, u2: number): number {
  return Math.sqrt(-2 * Math.log(u1 + 1e-12)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Bounded random-walk signal generator for a single sensor.
 * Deterministic when cfg.seed is provided.
 */
export class SignalGenerator {
  private value: number;
  private readonly min: number;
  private readonly max: number;
  private readonly walkStep: number;
  private readonly rng: () => number;

  constructor(cfg: SensorConfig) {
    this.min = cfg.min;
    this.max = cfg.max;
    this.walkStep = cfg.walkStep;
    this.value = (cfg.min + cfg.max) / 2; // start at midpoint

    const seed = cfg.seed ?? Math.floor(Math.random() * 0xffffffff);
    this.rng = mulberry32(seed);
  }

  next(): number {
    const u1 = this.rng();
    const u2 = this.rng();
    const step = gaussianFromUniform(u1, u2) * this.walkStep;
    this.value = Math.max(this.min, Math.min(this.max, this.value + step));
    return Math.round(this.value * 1000) / 1000; // 3 decimal places
  }
}

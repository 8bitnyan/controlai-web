import type { SensorConfig } from '../types.js';
import { clamp, createRng } from './rng.js';

export class TiltGenerator {
  private readonly rng: () => number;
  private readonly chainLength: number;
  private readonly values: number[];
  constructor(private readonly cfg: SensorConfig) {
    this.rng = createRng(cfg.seed);
    this.chainLength = cfg.chainLength ?? 4;
    this.values = Array.from({ length: this.chainLength }, () => (cfg.min + cfg.max) / 2);
  }
  next(): number[] {
    const drift = this.cfg.tiltDriftRate ?? 0.03;
    for (let i = 0; i < this.values.length; i += 1) {
      const step = (this.rng() - 0.5) * drift;
      this.values[i] = clamp((this.values[i] ?? 0) + step, this.cfg.min, this.cfg.max);
    }
    return this.values.map((v) => Math.round(v * 1000) / 1000);
  }
}

import type { SensorConfig } from '../types.js';
import { clamp, createRng } from './rng.js';

export class CrackEncoderGenerator {
  private readonly rng: () => number;
  private value: number;
  constructor(private readonly cfg: SensorConfig) {
    this.rng = createRng(cfg.seed);
    this.value = (cfg.min + cfg.max) / 2;
  }
  next(): number {
    const rate = this.cfg.burstRate ?? 0.01;
    if (this.rng() < rate) {
      const step = (this.rng() - 0.4) * ((this.cfg.max - this.cfg.min) * 0.2);
      this.value += step;
    }
    this.value += (this.rng() - 0.5) * 0.02;
    return Math.round(clamp(this.value, this.cfg.min, this.cfg.max) * 1000) / 1000;
  }
}

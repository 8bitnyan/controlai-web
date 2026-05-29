import type { SensorConfig } from '../types.js';
import { clamp, createRng } from './rng.js';

export class VibrationGenerator {
  private readonly rng: () => number;
  private t = 0;
  constructor(private readonly cfg: SensorConfig) {
    this.rng = createRng(cfg.seed);
  }
  next(): number {
    this.t += 1;
    const amp = this.cfg.vibrationAmplitude ?? (this.cfg.max - this.cfg.min) * 0.2;
    const freq = this.cfg.vibrationFrequency ?? 0.2;
    const envelope = 0.9 + this.rng() * 0.2;
    const noise = (this.rng() - 0.5) * amp * 0.1;
    const value = Math.sin(this.t * freq) * amp * envelope + noise;
    return Math.round(clamp(value, this.cfg.min, this.cfg.max) * 1000) / 1000;
  }
}

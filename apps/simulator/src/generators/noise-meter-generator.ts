import type { SensorConfig } from '../types.js';
import { clamp, createRng } from './rng.js';

export class NoiseMeterGenerator {
  private readonly rng: () => number;
  private value: number;
  constructor(private readonly cfg: SensorConfig) {
    this.rng = createRng(cfg.seed);
    const floor = cfg.noiseFloor ?? cfg.min;
    const peak = cfg.noisePeak ?? cfg.max;
    this.value = (floor + peak) / 2;
  }
  next(): number {
    const floor = this.cfg.noiseFloor ?? this.cfg.min;
    const peak = this.cfg.noisePeak ?? this.cfg.max;
    const cycle = Math.sin(Date.now() / 30000) * 6;
    const noise = (this.rng() - 0.5) * 2;
    this.value = clamp(this.value + cycle * 0.03 + noise, floor, peak);
    return Math.round(this.value * 10) / 10;
  }
}

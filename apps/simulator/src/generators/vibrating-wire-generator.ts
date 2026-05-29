import type { SensorConfig } from '../types.js';
import { clamp, createRng } from './rng.js';

export class VibratingWireGenerator {
  private readonly rng: () => number;
  private value: number;
  private t = 0;
  constructor(private readonly cfg: SensorConfig) {
    this.rng = createRng(cfg.seed);
    this.value = (cfg.min + cfg.max) / 2;
  }
  next(): number {
    this.t += 1;
    const drift = (this.rng() - 0.5) * (this.cfg.vwDriftRate ?? 0.4);
    const resonance = Math.sin(this.t * 0.08) * (this.cfg.vwResonanceAmplitude ?? 8);
    const damping = this.cfg.vwDampingRatio ?? 0.2;
    this.value = this.value * (1 - damping * 0.02) + resonance * 0.02 + drift;
    return Math.round(clamp(this.value, this.cfg.min, this.cfg.max) * 1000) / 1000;
  }
}

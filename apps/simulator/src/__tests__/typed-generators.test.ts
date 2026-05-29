import { describe, expect, it } from 'vitest';
import type { SensorConfig } from '../types.js';
import {
  CrackEncoderGenerator,
  NoiseMeterGenerator,
  TiltGenerator,
  VibrationGenerator,
  VibratingWireGenerator,
} from '../generators/index.js';

const baseConfig: SensorConfig = {
  id: 's1',
  unit: 'raw',
  type: 'vibration',
  min: 0,
  max: 100,
  walkStep: 1,
  intervalMs: 1000,
  seed: 42,
};

describe('typed signal generators', () => {
  it('tilt emits chainLength values within bounds', () => {
    const gen = new TiltGenerator({ ...baseConfig, pattern: 'tilt', chainLength: 4, min: -15, max: 15 });
    const values = gen.next();
    expect(Array.isArray(values)).toBe(true);
    expect(values).toHaveLength(4);
    for (const v of values) expect(v).toBeGreaterThanOrEqual(-15);
  });

  it('vibration oscillates near center and respects amplitude', () => {
    const gen = new VibrationGenerator({ ...baseConfig, pattern: 'vibration', min: -5, max: 5, vibrationAmplitude: 2 });
    const sample = Array.from({ length: 20 }, () => gen.next() as number);
    expect(Math.max(...sample)).toBeLessThanOrEqual(2.5);
    expect(Math.min(...sample)).toBeGreaterThanOrEqual(-2.5);
  });

  it('crack-encoder produces sparse bursts within bounds', () => {
    const gen = new CrackEncoderGenerator({ ...baseConfig, pattern: 'crack-encoder', min: 0, max: 50, burstRate: 0.2 });
    const sample = Array.from({ length: 100 }, () => gen.next() as number);
    expect(sample.every((v) => v >= 0 && v <= 50)).toBe(true);
  });

  it('noise-meter keeps dBA in configured envelope', () => {
    const gen = new NoiseMeterGenerator({ ...baseConfig, pattern: 'noise-meter', noiseFloor: 30, noisePeak: 90 });
    const sample = Array.from({ length: 100 }, () => gen.next() as number);
    expect(Math.min(...sample)).toBeGreaterThanOrEqual(30);
    expect(Math.max(...sample)).toBeLessThanOrEqual(90);
  });

  it('vibrating-wire stays between 0 and 300Hz with drift', () => {
    const gen = new VibratingWireGenerator({ ...baseConfig, pattern: 'vibrating-wire', min: 0, max: 300 });
    const sample = Array.from({ length: 50 }, () => gen.next() as number);
    expect(sample.every((v) => v >= 0 && v <= 300)).toBe(true);
  });

  it('same seed yields deterministic sequence', () => {
    const cfg: SensorConfig = { ...baseConfig, pattern: 'vibration', vibrationAmplitude: 3 };
    const a = new VibrationGenerator(cfg);
    const b = new VibrationGenerator(cfg);
    expect(Array.from({ length: 10 }, () => a.next())).toEqual(Array.from({ length: 10 }, () => b.next()));
  });
});

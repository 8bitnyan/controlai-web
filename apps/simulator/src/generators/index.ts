import type { SensorConfig } from '../types.js';
import { SignalGenerator } from '../signal-generator.js';
import { CrackEncoderGenerator } from './crack-encoder-generator.js';
import { NoiseMeterGenerator } from './noise-meter-generator.js';
import { TiltGenerator } from './tilt-generator.js';
import { VibrationGenerator } from './vibration-generator.js';
import { VibratingWireGenerator } from './vibrating-wire-generator.js';

export { TiltGenerator, VibrationGenerator, CrackEncoderGenerator, NoiseMeterGenerator, VibratingWireGenerator };

export type GeneratorOutput = number | number[];
export type RuntimeGenerator = { next: () => GeneratorOutput };

export function createGenerator(cfg: SensorConfig): RuntimeGenerator {
  switch (cfg.pattern) {
    case 'tilt': return new TiltGenerator(cfg);
    case 'vibration': return new VibrationGenerator(cfg);
    case 'crack-encoder': return new CrackEncoderGenerator(cfg);
    case 'noise-meter': return new NoiseMeterGenerator(cfg);
    case 'vibrating-wire': return new VibratingWireGenerator(cfg);
    case 'random-walk':
    default:
      return new SignalGenerator(cfg);
  }
}

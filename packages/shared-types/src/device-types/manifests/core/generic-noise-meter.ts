import { registerDeviceType } from '../../registry';

registerDeviceType({
  id: 'core-generic-noise-meter',
  displayName: 'Generic Noise Meter / 범용 소음계',
  manufacturer: 'ControlAI',
  model: 'GEN-NOISE-METER',
  category: 'sensor',
  visual: { iconRef: 'mic', accentColor: '#ef4444' },
  ports: [{ id: 'upstream', direction: 'out', portType: 'analog-input', maxCount: 1, acceptsProtocols: ['analog-4-20ma'] }],
  defaultSignal: { rateMs: 1000, format: 'binary', units: 'dBA', range: { min: 30, max: 130 } },
  constraints: { minIntervalMs: 100 },
});

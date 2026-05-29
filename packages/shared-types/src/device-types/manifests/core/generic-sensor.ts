import { registerDeviceType } from '../../registry';

registerDeviceType({
  id: 'core-generic-sensor',
  displayName: 'Generic Sensor',
  manufacturer: 'ControlAI',
  model: 'GEN-SENSOR',
  category: 'sensor',
  visual: { iconRef: 'thermometer', accentColor: '#10b981' },
  ports: [],
  defaultSignal: { rateMs: 1000, format: 'json', units: 'value', range: { min: 0, max: 100 } },
  constraints: { minIntervalMs: 100 },
});

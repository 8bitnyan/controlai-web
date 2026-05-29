import { registerDeviceType } from '../../registry';

registerDeviceType({
  id: 'core-generic-tsdb',
  displayName: 'Generic TSDB',
  manufacturer: 'ControlAI',
  model: 'GEN-TSDB',
  category: 'tsdb',
  visual: { iconRef: 'database', accentColor: '#06b6d4' },
  ports: [],
  constraints: { minIntervalMs: 100 },
});

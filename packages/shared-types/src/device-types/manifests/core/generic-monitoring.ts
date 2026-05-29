import { registerDeviceType } from '../../registry';

registerDeviceType({
  id: 'core-generic-monitoring',
  displayName: 'Generic Monitoring',
  manufacturer: 'ControlAI',
  model: 'GEN-MONITOR',
  category: 'monitoring',
  visual: { iconRef: 'activity', accentColor: '#ef4444' },
  ports: [],
  constraints: { minIntervalMs: 100 },
});

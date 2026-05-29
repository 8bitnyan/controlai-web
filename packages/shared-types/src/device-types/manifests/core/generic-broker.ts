import { registerDeviceType } from '../../registry';

registerDeviceType({
  id: 'core-generic-broker',
  displayName: 'Generic Broker',
  manufacturer: 'ControlAI',
  model: 'GEN-BROKER',
  category: 'broker',
  visual: { iconRef: 'radio-tower', accentColor: '#f59e0b' },
  ports: [{ id: 'mqtt-1', direction: 'bidir', portType: 'mqtt-topic', maxCount: 1000, acceptsProtocols: ['mqtt'] }],
  constraints: { minIntervalMs: 100 },
});

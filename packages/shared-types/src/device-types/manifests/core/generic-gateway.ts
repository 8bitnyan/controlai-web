import { registerDeviceType } from '../../registry';

registerDeviceType({
  id: 'core-generic-gateway',
  displayName: 'Generic Gateway',
  manufacturer: 'ControlAI',
  model: 'GEN-GATEWAY',
  category: 'gateway',
  visual: { iconRef: 'router', accentColor: '#3b82f6' },
  ports: [{ id: 'rs485-1', direction: 'in', portType: 'rs485-bus', maxCount: 16, acceptsProtocols: ['modbus-rtu', 'rs485-serial-generic'] }],
  constraints: { minIntervalMs: 100 },
});

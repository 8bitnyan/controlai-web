import { registerDeviceType } from '../../registry';

registerDeviceType({
  id: 'core-generic-vibration-tilt-standalone',
  displayName: 'Generic Vibration Tilt Standalone / 범용 진동-경사 단독형',
  manufacturer: 'ControlAI',
  model: 'GEN-VIB-TILT-STANDALONE',
  category: 'sensor',
  visual: { iconRef: 'activity', accentColor: '#f59e0b' },
  ports: [{ id: 'upstream', direction: 'out', portType: 'rs485-bus', maxCount: 1, acceptsProtocols: ['modbus-rtu', 'rs485-serial-generic'] }],
  defaultSignal: { rateMs: 1000, format: 'json', units: 'g/deg', range: { min: 0, max: 180 } },
  constraints: { minIntervalMs: 100 },
});

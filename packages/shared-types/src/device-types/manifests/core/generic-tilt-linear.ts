import { registerDeviceType } from '../../registry';

registerDeviceType({
  id: 'core-generic-tilt-linear',
  displayName: 'Generic Tilt Linear / 범용 경사-선형 센서',
  manufacturer: 'ControlAI',
  model: 'GEN-TILT-LINEAR',
  category: 'sensor',
  visual: { iconRef: 'ruler', accentColor: '#14b8a6' },
  ports: [{ id: 'upstream', direction: 'out', portType: 'rs485-bus', maxCount: 16, acceptsProtocols: ['modbus-rtu', 'rs485-serial-generic'] }],
  defaultSignal: { rateMs: 1000, format: 'json', units: 'deg', range: { min: -180, max: 180 } },
  datasheet: { certifications: ['chainLength:1-16 default:4'] },
  constraints: { minIntervalMs: 100 },
});

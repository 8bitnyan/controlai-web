import { registerDeviceType } from '../../registry';

registerDeviceType({
  id: 'core-generic-vibrating-wire-sensor',
  displayName: 'Generic Vibrating Wire Sensor / 범용 진동현 센서',
  manufacturer: 'ControlAI',
  model: 'GEN-VW-SENSOR',
  category: 'sensor',
  visual: { iconRef: 'waveform', accentColor: '#22c55e' },
  ports: [{ id: 'upstream', direction: 'out', portType: 'rs485-bus', maxCount: 1, acceptsProtocols: ['modbus-rtu', 'rs485-serial-generic'] }],
  defaultSignal: { rateMs: 1000, format: 'json', units: 'Hz', range: { min: 10, max: 5000 } },
  constraints: { minIntervalMs: 100 },
});

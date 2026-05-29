import { registerDeviceType } from '../../registry';

registerDeviceType({
  id: 'core-generic-sensor-input',
  displayName: 'Generic Sensor Input / 범용 센서 입력기',
  manufacturer: 'ControlAI',
  model: 'GEN-SENSOR-INPUT',
  category: 'sensor',
  visual: { iconRef: 'gauge', accentColor: '#0ea5e9' },
  ports: [
    { id: 'upstream', direction: 'out', portType: 'rs485-bus', maxCount: 1, acceptsProtocols: ['modbus-rtu', 'rs485-serial-generic'] },
    { id: 'child-rs485-1', direction: 'out', portType: 'rs485-bus', maxCount: 1, acceptsProtocols: ['modbus-rtu', 'rs485-serial-generic'] },
    { id: 'child-rs485-2', direction: 'out', portType: 'rs485-bus', maxCount: 1, acceptsProtocols: ['modbus-rtu', 'rs485-serial-generic'] },
    { id: 'child-rs485-3', direction: 'out', portType: 'rs485-bus', maxCount: 1, acceptsProtocols: ['modbus-rtu', 'rs485-serial-generic'] },
    { id: 'noise-input', direction: 'out', portType: 'analog-input', maxCount: 1, acceptsProtocols: ['analog-4-20ma'] },
  ],
  defaultSignal: { rateMs: 1000, format: 'json', units: 'Hz', range: { min: 100, max: 1000 } },
  constraints: { minIntervalMs: 100 },
});

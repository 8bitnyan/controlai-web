import { registerDeviceType } from '../../registry';

registerDeviceType({
  id: 'core-generic-control-485x2',
  displayName: 'Generic Control 485x2 / 범용 제어기 485x2',
  manufacturer: 'ControlAI',
  model: 'GEN-CONTROL-485X2',
  category: 'sensor',
  visual: { iconRef: 'cpu', accentColor: '#8b5cf6' },
  ports: [
    { id: 'upstream', direction: 'out', portType: 'rs485-bus', maxCount: 1, acceptsProtocols: ['modbus-rtu', 'rs485-serial-generic'] },
    { id: 'child-rs485-1', direction: 'out', portType: 'rs485-bus', maxCount: 1, acceptsProtocols: ['modbus-rtu', 'rs485-serial-generic'] },
    { id: 'child-rs485-2', direction: 'out', portType: 'rs485-bus', maxCount: 1, acceptsProtocols: ['modbus-rtu', 'rs485-serial-generic'] },
  ],
  defaultSignal: { rateMs: 1000, format: 'json', units: 'state', range: { min: 0, max: 1 } },
  constraints: { minIntervalMs: 100 },
});

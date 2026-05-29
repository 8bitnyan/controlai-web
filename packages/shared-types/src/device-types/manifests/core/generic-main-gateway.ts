import { registerDeviceType } from '../../registry';

registerDeviceType({
  id: 'core-generic-main-gateway',
  displayName: 'Generic Main Gateway / 범용 메인 게이트웨이',
  manufacturer: 'ControlAI',
  model: 'GEN-MAIN-GATEWAY',
  category: 'gateway',
  visual: { iconRef: 'router', accentColor: '#2563eb' },
  ports: [
    { id: 'rs485-1', direction: 'in', portType: 'rs485-bus', maxCount: 16, acceptsProtocols: ['modbus-rtu', 'rs485-serial-generic'] },
    { id: 'rs485-2', direction: 'in', portType: 'rs485-bus', maxCount: 16, acceptsProtocols: ['modbus-rtu', 'rs485-serial-generic'] },
    { id: 'mqtt-listen', direction: 'in', portType: 'mqtt-topic', maxCount: 1, acceptsProtocols: ['mqtt'] },
  ],
  constraints: { minIntervalMs: 100 },
});

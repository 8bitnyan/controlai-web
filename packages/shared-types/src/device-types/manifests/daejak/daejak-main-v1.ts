import { registerDeviceType } from '../../registry';

registerDeviceType({
  id: 'daejak-main-v1',
  displayName: 'DAEJAK MAIN v1',
  manufacturer: 'DAEJAK',
  model: 'MAIN-V1',
  category: 'gateway',
  firmwareTypeIds: ['DAEJAK_MAIN_V1'],
  visual: { iconRef: 'router', accentColor: '#2563eb' },
  ports: [{ id: 'rs485-1', direction: 'in', portType: 'rs485-bus', maxCount: 16, acceptsProtocols: ['modbus-rtu'] }],
  constraints: { minIntervalMs: 100 },
});

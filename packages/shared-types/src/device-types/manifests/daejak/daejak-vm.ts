import { registerDeviceType } from '../../registry';

registerDeviceType({
  id: 'daejak-vm',
  displayName: 'DAEJAK VM',
  manufacturer: 'DAEJAK',
  model: 'VM',
  category: 'sensor',
  firmwareTypeIds: ['DAEJAK_VM'],
  visual: { iconRef: 'gauge', accentColor: '#0ea5e9' },
  ports: [],
  defaultSignal: { rateMs: 1000, format: 'cbor', units: 'V', range: { min: 0, max: 24 } },
  constraints: { minIntervalMs: 100 },
});

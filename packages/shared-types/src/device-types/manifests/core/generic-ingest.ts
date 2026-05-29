import { registerDeviceType } from '../../registry';

registerDeviceType({
  id: 'core-generic-ingest',
  displayName: 'Generic Ingest',
  manufacturer: 'ControlAI',
  model: 'GEN-INGEST',
  category: 'ingest',
  visual: { iconRef: 'arrow-down-to-line', accentColor: '#8b5cf6' },
  ports: [],
  constraints: { minIntervalMs: 100 },
});

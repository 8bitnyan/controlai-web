import { beforeEach, describe, expect, it } from 'vitest';
import { defaultNodeData, LEGACY_TYPE_MAP } from '../default-data';
import { __resetRegistryForTests, registerDeviceType } from '../registry';

describe('defaultNodeData', () => {
  beforeEach(() => {
    __resetRegistryForTests();
    registerDeviceType({
      id: 'core-generic-sensor', displayName: 'Sensor', manufacturer: 'Core', model: 'S1', category: 'sensor', firmwareTypeIds: [], ports: [],
      defaultSignal: { rateMs: 1000, format: 'json', units: 'C', range: { min: 0, max: 100 } },
      visual: { iconRef: 'gauge', accentColor: '#10b981' }, datasheet: {}, registrationHints: {}, constraints: { minIntervalMs: 100 },
    });
    registerDeviceType({
      id: 'core-generic-gateway', displayName: 'Gateway', manufacturer: 'Core', model: 'G1', category: 'gateway', firmwareTypeIds: [],
      ports: [{ id: 'rs485-1', direction: 'in', portType: 'rs485-bus', maxCount: 16, acceptsProtocols: ['modbus-rtu'] }],
      visual: { iconRef: 'router', accentColor: '#3b82f6' }, datasheet: {}, registrationHints: {}, constraints: { minIntervalMs: 100 },
    });
  });

  it('seeds expected node shape for sensor', () => {
    expect(defaultNodeData('core-generic-sensor')).toMatchObject({
      deviceTypeId: 'core-generic-sensor',
      category: 'sensor',
      label: 'Sensor',
      visual: { iconRef: 'gauge', accentColor: '#10b981' },
      config: {},
      status: 'normal',
      msgPerSec: 0,
    });
  });

  it('seeds expected node shape for gateway', () => {
    expect(defaultNodeData('core-generic-gateway')).toMatchObject({
      deviceTypeId: 'core-generic-gateway',
      category: 'gateway',
      label: 'Gateway',
      visual: { iconRef: 'router', accentColor: '#3b82f6' },
      config: {},
      status: 'normal',
      msgPerSec: 0,
    });
  });

  it('legacy map has canonical ids', () => {
    expect(LEGACY_TYPE_MAP).toEqual({
      sensor: 'core-generic-sensor',
      gateway: 'core-generic-gateway',
      broker: 'core-generic-broker',
      ingest: 'core-generic-ingest',
      timescaledb: 'core-generic-tsdb',
      monitoring: 'core-generic-monitoring',
    });
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { DeviceType } from '../schema';
import {
  __resetRegistryForTests,
  assertKnownDeviceType,
  getDeviceType,
  listDeviceTypes,
  registerDeviceType,
} from '../registry';

const sensor: DeviceType = {
  id: 'core-generic-sensor',
  displayName: 'Sensor',
  manufacturer: 'Core',
  model: 'S1',
  category: 'sensor',
  firmwareTypeIds: ['F1'],
  ports: [],
  defaultSignal: { rateMs: 1000, format: 'json', units: 'C', range: { min: 0, max: 100 } },
  visual: { iconRef: 'gauge', accentColor: '#10b981' },
  datasheet: { certifications: [] },
  registrationHints: { expectedChildTypeIds: [] },
  constraints: { minIntervalMs: 100 },
};

const gateway: DeviceType = {
  id: 'core-generic-gateway',
  displayName: 'Gateway',
  manufacturer: 'Core',
  model: 'G1',
  category: 'gateway',
  firmwareTypeIds: ['GW'],
  ports: [
    {
      id: 'rs485-1',
      direction: 'in',
      portType: 'rs485-bus',
      maxCount: 16,
      acceptsProtocols: ['modbus-rtu', 'rs485-serial-generic'],
    },
  ],
  visual: { iconRef: 'router', accentColor: '#3b82f6' },
  datasheet: { certifications: [] },
  registrationHints: { expectedChildTypeIds: [] },
  constraints: { minIntervalMs: 100 },
};

describe('registry', () => {
  beforeEach(() => {
    __resetRegistryForTests();
  });

  it('register/get happy path', () => {
    registerDeviceType(sensor);
    expect(getDeviceType(sensor.id)?.id).toBe(sensor.id);
  });

  it('getDeviceType returns undefined for missing id', () => {
    expect(getDeviceType('missing')).toBeUndefined();
  });

  it('listDeviceTypes returns all registered', () => {
    registerDeviceType(sensor);
    registerDeviceType(gateway);
    expect(listDeviceTypes()).toHaveLength(2);
  });

  it('listDeviceTypes filters by category', () => {
    registerDeviceType(sensor);
    registerDeviceType(gateway);
    expect(listDeviceTypes({ category: 'sensor' }).map((d) => d.id)).toEqual(['core-generic-sensor']);
  });

  it('listDeviceTypes filter empty when none match', () => {
    registerDeviceType(sensor);
    expect(listDeviceTypes({ category: 'gateway' })).toEqual([]);
  });

  it('listDeviceTypes returns insertion order', () => {
    registerDeviceType(sensor);
    registerDeviceType(gateway);
    expect(listDeviceTypes().map((d) => d.id)).toEqual([sensor.id, gateway.id]);
  });

  it('duplicate id throws with required prefix', () => {
    registerDeviceType(sensor);
    expect(() => registerDeviceType(sensor)).toThrow(/Duplicate device-type id:/);
  });

  it('duplicate id error includes first call site hint', () => {
    registerDeviceType(sensor);
    try {
      registerDeviceType(sensor);
      throw new Error('expected duplicate error');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('Duplicate device-type id:');
      expect(message).toContain('First registration:');
      expect(message).toContain('registry.spec.ts');
    }
  });

  it('assertKnownDeviceType passes for known id', () => {
    registerDeviceType(sensor);
    expect(() => assertKnownDeviceType(sensor.id)).not.toThrow();
  });

  it('assertKnownDeviceType throws UNKNOWN_DEVICE_TYPE for missing', () => {
    try {
      assertKnownDeviceType('missing');
      throw new Error('expected throw');
    } catch (error) {
      const err = error as Error & { code?: string };
      expect(err.code).toBe('UNKNOWN_DEVICE_TYPE');
      expect(err.message).toContain('Unknown device type: missing');
    }
  });

  it('registerDeviceType parses unknown and rejects invalid manifests', () => {
    expect(() => registerDeviceType({ id: 'bad' })).toThrow();
  });

  it('reset helper clears registry', () => {
    registerDeviceType(sensor);
    __resetRegistryForTests();
    expect(listDeviceTypes()).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { assertKnownDeviceType, listDeviceTypes, validateConnection } from '../device-types';
import '../device-types';

const NEW_IDS = [
  'core-generic-main-gateway',
  'core-generic-sensor-input',
  'core-generic-tilt-linear',
  'core-generic-vibration-tilt-standalone',
  'core-generic-control-485x2',
  'core-generic-vibrating-wire-sensor',
  'core-generic-noise-meter',
] as const;

describe('device type new manifests', () => {
  it('loads all seven manifests and resolves known ids', () => {
    const ids = new Set(listDeviceTypes().map((item) => item.id));
    for (const id of NEW_IDS) {
      expect(ids.has(id)).toBe(true);
      expect(() => assertKnownDeviceType(id)).not.toThrow();
    }
  });

  it('allows noise meter only under generic sensor input', () => {
    expect(
      validateConnection({
        sourceId: 'core-generic-noise-meter',
        sourceCurrentChildren: 0,
        targetId: 'core-generic-sensor-input',
        targetPortId: 'noise-input',
        targetCurrentParents: 0,
      }).ok,
    ).toBe(true);

    const rejected = validateConnection({
      sourceId: 'core-generic-noise-meter',
      sourceCurrentChildren: 0,
      targetId: 'core-generic-main-gateway',
      targetPortId: 'rs485-1',
      targetCurrentParents: 0,
    });
    expect(rejected.ok).toBe(false);
  });

  it('allows tilt-linear self-chaining and gateway parenting', () => {
    expect(
      validateConnection({
        sourceId: 'core-generic-tilt-linear',
        sourceCurrentChildren: 0,
        targetId: 'core-generic-main-gateway',
        targetPortId: 'rs485-1',
        targetCurrentParents: 0,
      }).ok,
    ).toBe(true);

    expect(
      validateConnection({
        sourceId: 'core-generic-tilt-linear',
        sourceCurrentChildren: 0,
        targetId: 'core-generic-tilt-linear',
        targetPortId: 'upstream',
        targetCurrentParents: 0,
      }).ok,
    ).toBe(true);
  });
});

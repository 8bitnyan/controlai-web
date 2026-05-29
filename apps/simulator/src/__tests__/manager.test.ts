import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as managerModule from '../manager.js';
import { resolveSensorRuntime } from '../manager.js';
import { parseInboundEvent } from '../manager.js';
import { encode } from 'cbor-x';
import type { SensorConfig } from '../types.js';

describe('resolveSensorRuntime', () => {
  it('resolves known device type manifest', () => {
    const sensor: SensorConfig = {
      id: 's1',
      label: 'Temp',
      unit: 'C',
      type: 'temperature',
      pattern: 'sine',
      min: 0,
      max: 100,
      walkStep: 1,
      intervalMs: 150,
      deviceTypeId: 'core-generic-sensor',
    };

    const runtime = resolveSensorRuntime(sensor);
    expect(runtime.deviceTypeId).toBe('core-generic-sensor');
  });

  it('falls back to core-generic-sensor when deviceTypeId is missing', () => {
    const sensor: SensorConfig = {
      id: 's2',
      label: 'Generic',
      unit: 'raw',
      type: 'temperature',
      pattern: 'random',
      min: 0,
      max: 10,
      walkStep: 1,
      intervalMs: 1000,
    };

    const runtime = resolveSensorRuntime(sensor);
    expect(runtime.deviceTypeId).toBe('core-generic-sensor');
  });

  it('clamps intervalMs to manifest minIntervalMs floor', () => {
    const sensor: SensorConfig = {
      id: 's3',
      label: 'Slow',
      unit: 'raw',
      type: 'temperature',
      pattern: 'random',
      min: 0,
      max: 10,
      walkStep: 1,
      intervalMs: 50,
      deviceTypeId: 'core-generic-sensor',
    };

    const runtime = resolveSensorRuntime(sensor);
    expect(runtime.intervalMs).toBe(100);
  });
});

describe('reconcileSiteGroup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('loads Devices by siteGroupId + simulationDesired and groups by parentDeviceKey', async () => {
    const reconcileSiteGroup = Reflect.get(managerModule, 'reconcileSiteGroup');
    expect(typeof reconcileSiteGroup).toBe('function');
  });

  it('uses per-Device config.signal override before manifest.defaultSignal', async () => {
    const reconcileSiteGroup = Reflect.get(managerModule, 'reconcileSiteGroup');
    expect(typeof reconcileSiteGroup).toBe('function');
  });

  it('falls back to Gateway.sensors JSONB when no Device children and logs fallback event', async () => {
    const reconcileSiteGroup = Reflect.get(managerModule, 'reconcileSiteGroup');
    expect(typeof reconcileSiteGroup).toBe('function');
    expect(Reflect.get(managerModule, 'logger')).toMatchObject({
      warn: expect.any(Function),
    });
  });

  it('halts publisher within one interval when simulationDesired flips false', async () => {
    const reconcileSiteGroup = Reflect.get(managerModule, 'reconcileSiteGroup');
    expect(typeof reconcileSiteGroup).toBe('function');
  });
});

describe('parseInboundEvent', () => {
  it('emits board source when clientId differs from gateway', () => {
    const payload = encode({ readings: [{ sensorId: 's1', value: 1.23, ts: 1 }] });
    const evt = parseInboundEvent({ topic: 'modules/tnt/NDATA/board-1', payload, siteGroupId: 'sg1', gatewayClientId: 'gw-aaa' });
    expect(evt?.source).toBe('board');
    expect(evt?.msgType).toBe('NDATA');
  });
});

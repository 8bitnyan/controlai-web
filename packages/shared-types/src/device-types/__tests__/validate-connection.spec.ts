import { beforeEach, describe, expect, it } from 'vitest';
import { DeviceType } from '../schema';
import { __resetRegistryForTests, registerDeviceType, validateConnection } from '../registry';

const sensorJson: DeviceType = {
  id: 'core-generic-sensor', displayName: 'Sensor', manufacturer: 'Core', model: 'S1', category: 'sensor',
  firmwareTypeIds: [], ports: [], defaultSignal: { rateMs: 1000, format: 'json', units: 'C', range: { min: 0, max: 100 } },
  visual: { iconRef: 'gauge', accentColor: '#10b981' }, datasheet: { certifications: [] }, registrationHints: { expectedChildTypeIds: [] }, constraints: { minIntervalMs: 100 },
};
const sensorAnalog: DeviceType = {
  ...sensorJson,
  id: 'analog-sensor',
  model: 'S2',
  defaultSignal: { rateMs: 1000, format: 'binary', units: 'C', range: { min: 0, max: 100 } },
};
const gateway: DeviceType = {
  id: 'core-generic-gateway', displayName: 'Gateway', manufacturer: 'Core', model: 'G1', category: 'gateway', firmwareTypeIds: [],
  ports: [
    { id: 'rs485-1', direction: 'in', portType: 'rs485-bus', maxCount: 2, acceptsProtocols: ['modbus-rtu', 'rs485-serial-generic'] },
    { id: 'analog-1', direction: 'in', portType: 'analog-input', maxCount: 2, acceptsProtocols: ['analog-4-20ma'] },
  ],
  visual: { iconRef: 'router', accentColor: '#3b82f6' }, datasheet: { certifications: [] }, registrationHints: { expectedChildTypeIds: [] }, constraints: { minIntervalMs: 100 },
};
const broker: DeviceType = {
  id: 'core-generic-broker', displayName: 'Broker', manufacturer: 'Core', model: 'B1', category: 'broker', firmwareTypeIds: [],
  ports: [{ id: 'mqtt-1', direction: 'bidir', portType: 'mqtt-topic', maxCount: 10, acceptsProtocols: ['mqtt'] }],
  visual: { iconRef: 'radio-tower', accentColor: '#f59e0b' }, datasheet: { certifications: [] }, registrationHints: { expectedChildTypeIds: [] }, constraints: { minIntervalMs: 100 },
};

describe('validateConnection', () => {
  beforeEach(() => {
    __resetRegistryForTests();
    registerDeviceType(sensorJson);
    registerDeviceType(sensorAnalog);
    registerDeviceType(gateway);
    registerDeviceType(broker);
  });

  it('returns ok for sensor->gateway via rs485 bus', () => {
    expect(validateConnection({ sourceId: sensorJson.id, sourceCurrentChildren: 0, targetId: gateway.id, targetPortId: 'rs485-1', targetCurrentParents: 0 })).toEqual({ ok: true });
  });
  it('unknown source id', () => {
    const result = validateConnection({ sourceId: 'missing', sourceCurrentChildren: 0, targetId: gateway.id, targetCurrentParents: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNKNOWN_DEVICE_TYPE');
  });
  it('unknown target id', () => {
    const result = validateConnection({ sourceId: sensorJson.id, sourceCurrentChildren: 0, targetId: 'missing', targetCurrentParents: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNKNOWN_DEVICE_TYPE');
  });
  it('invalid category pair broker->sensor', () => {
    const result = validateConnection({ sourceId: broker.id, sourceCurrentChildren: 0, targetId: sensorJson.id, targetCurrentParents: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_CATEGORY_PAIR');
  });
  it('protocol mismatch analog->rs485-only', () => {
    const result = validateConnection({ sourceId: sensorAnalog.id, sourceCurrentChildren: 0, targetId: gateway.id, targetPortId: 'rs485-1', targetCurrentParents: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PROTOCOL_MISMATCH');
  });
  it('capacity exceeded source side', () => {
    const sourceWithOut = { ...sensorJson, id: 'sensor-with-port', ports: [{ id: 'out-1', direction: 'out', portType: 'rs485-bus', maxCount: 1, acceptsProtocols: ['modbus-rtu'] }] };
    registerDeviceType(sourceWithOut);
    const result = validateConnection({ sourceId: sourceWithOut.id, sourcePortId: 'out-1', sourceCurrentChildren: 1, targetId: gateway.id, targetPortId: 'rs485-1', targetCurrentParents: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('CAPACITY_EXCEEDED');
  });
  it('capacity exceeded target side', () => {
    const result = validateConnection({ sourceId: sensorJson.id, sourceCurrentChildren: 0, targetId: gateway.id, targetPortId: 'rs485-1', targetCurrentParents: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('CAPACITY_EXCEEDED');
  });
  it('ordered check keeps unknown before other errors', () => {
    const result = validateConnection({ sourceId: 'missing', sourceCurrentChildren: 99, targetId: 'missing-target', targetPortId: 'nope', targetCurrentParents: 99 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNKNOWN_DEVICE_TYPE');
  });
  it('ordered check invalid-category before protocol mismatch when no shared families', () => {
    const result = validateConnection({ sourceId: broker.id, sourceCurrentChildren: 0, targetId: gateway.id, targetPortId: 'rs485-1', targetCurrentParents: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_CATEGORY_PAIR');
  });
  it('sensor json infers modbus-rtu and rs485-serial-generic', () => expect(validateConnection({ sourceId: sensorJson.id, sourceCurrentChildren: 0, targetId: gateway.id, targetPortId: 'rs485-1', targetCurrentParents: 0 }).ok).toBe(true));
  it('target port missing by id yields protocol mismatch when explicit', () => {
    const result = validateConnection({ sourceId: sensorJson.id, sourceCurrentChildren: 0, targetId: gateway.id, targetPortId: 'missing-port', targetCurrentParents: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PROTOCOL_MISMATCH');
  });
  it('without targetPortId can still validate by category pair', () => expect(validateConnection({ sourceId: sensorJson.id, sourceCurrentChildren: 0, targetId: gateway.id, targetCurrentParents: 0 }).ok).toBe(true));
  it('success when source and target within capacity', () => expect(validateConnection({ sourceId: sensorJson.id, sourceCurrentChildren: 0, targetId: gateway.id, targetPortId: 'rs485-1', targetCurrentParents: 1 }).ok).toBe(true));
  it('result shape includes reason when not ok', () => {
    const result = validateConnection({ sourceId: broker.id, sourceCurrentChildren: 0, targetId: sensorJson.id, targetCurrentParents: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
  });
  it('sourcePortId missing does not block if category/protocol passes', () => expect(validateConnection({ sourceId: sensorJson.id, sourceCurrentChildren: 0, targetId: gateway.id, targetPortId: 'rs485-1', targetCurrentParents: 0 }).ok).toBe(true));
});

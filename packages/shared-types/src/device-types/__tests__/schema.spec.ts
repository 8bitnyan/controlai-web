import { describe, expect, it } from 'vitest';
import { DeviceTypeSchema } from '../schema';

const base = {
  id: 'core-generic-sensor', displayName: 'Sensor', manufacturer: 'Core', model: 'S1', category: 'sensor',
  firmwareTypeIds: ['F1'], ports: [{ id: 'out-1', direction: 'out', portType: 'mqtt-topic', maxCount: 1, acceptsProtocols: ['mqtt'] }],
  defaultSignal: { rateMs: 100, format: 'json', units: 'C', range: { min: 0, max: 100 } },
  visual: { iconRef: 'gauge', accentColor: '#10b981' }, constraints: { minIntervalMs: 100 },
};

describe('DeviceTypeSchema', () => {
  it('valid full manifest passes', () => expect(() => DeviceTypeSchema.parse(base)).not.toThrow());
  it('invalid accentColor fails', () => expect(() => DeviceTypeSchema.parse({ ...base, visual: { ...base.visual, accentColor: 'blue' } })).toThrow());
  it('invalid id regex fails', () => expect(() => DeviceTypeSchema.parse({ ...base, id: 'Bad_Id' })).toThrow());
  it('sensor without defaultSignal fails', () => expect(() => DeviceTypeSchema.parse({ ...base, defaultSignal: undefined })).toThrow());
  it('sensor with non-out port fails', () => expect(() => DeviceTypeSchema.parse({ ...base, ports: [{ ...base.ports[0], direction: 'in' }] })).toThrow());
  it('broker without exactly one mqtt-topic port fails', () => expect(() => DeviceTypeSchema.parse({ ...base, category: 'broker', defaultSignal: undefined, ports: [] })).toThrow());
  it('broker with defaultSignal fails', () => expect(() => DeviceTypeSchema.parse({ ...base, category: 'broker' })).toThrow());
  it('gateway without rs485/mqtt fails', () => expect(() => DeviceTypeSchema.parse({ ...base, category: 'gateway', defaultSignal: undefined, ports: [{ ...base.ports[0], portType: 'analog-input' }] })).toThrow());
  it('ingest with ports fails', () => expect(() => DeviceTypeSchema.parse({ ...base, category: 'ingest', defaultSignal: undefined })).toThrow());
  it('tsdb with ports fails', () => expect(() => DeviceTypeSchema.parse({ ...base, category: 'tsdb', defaultSignal: undefined })).toThrow());
  it('monitoring with ports fails', () => expect(() => DeviceTypeSchema.parse({ ...base, category: 'monitoring', defaultSignal: undefined })).toThrow());
  it('ingest with defaultSignal fails', () => expect(() => DeviceTypeSchema.parse({ ...base, category: 'ingest', ports: [], defaultSignal: base.defaultSignal })).toThrow());
  it('duplicate port ids fail', () => expect(() => DeviceTypeSchema.parse({ ...base, ports: [base.ports[0], base.ports[0]] })).toThrow());
  it('defaultSignal.rateMs < minIntervalMs fails', () => expect(() => DeviceTypeSchema.parse({ ...base, defaultSignal: { ...base.defaultSignal, rateMs: 50 } })).toThrow());
  it('strict unknown key fails', () => expect(() => DeviceTypeSchema.parse({ ...base, extra: true } as never)).toThrow());
  it('gateway valid with rs485 passes', () => expect(() => DeviceTypeSchema.parse({ ...base, category: 'gateway', defaultSignal: undefined, ports: [{ ...base.ports[0], portType: 'rs485-bus', acceptsProtocols: ['modbus-rtu'] }] })).not.toThrow());
  it('broker valid one mqtt passes', () => expect(() => DeviceTypeSchema.parse({ ...base, category: 'broker', defaultSignal: undefined, ports: [{ ...base.ports[0], portType: 'mqtt-topic' }] })).not.toThrow());
  it('ingest with no ports no defaultSignal passes', () => expect(() => DeviceTypeSchema.parse({ ...base, category: 'ingest', ports: [], defaultSignal: undefined })).not.toThrow());
});

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { BrokerDriverSchema, type BrokerDriverInstance } from '../schema';

function noopInstance(): BrokerDriverInstance {
  return {
    connect: async () => {},
    subscribe: async () => {},
    publish: async () => {},
    healthCheck: async () => ({ ok: true }),
    validateConfig: () => ({ ok: true }),
    close: async () => {},
  };
}

const valid = {
  id: 'mqtt-driver',
  displayName: 'MQTT Driver',
  supportedSiteCapabilities: ['mqtt-ingest'] as const,
  configSchema: z.object({ host: z.string() }),
  factory: () => noopInstance(),
};

describe('BrokerDriverSchema', () => {
  it('accepts a valid driver definition', () => {
    expect(() => BrokerDriverSchema.parse(valid)).not.toThrow();
  });

  it('rejects invalid id regex', () => {
    expect(() => BrokerDriverSchema.parse({ ...valid, id: 'MQTT_Driver' })).toThrow();
  });

  it('rejects missing factory', () => {
    const { factory: _factory, ...rest } = valid;
    expect(() => BrokerDriverSchema.parse(rest)).toThrow();
  });

  it('rejects missing configSchema', () => {
    const { configSchema: _configSchema, ...rest } = valid;
    expect(() => BrokerDriverSchema.parse(rest)).toThrow();
  });

  it('rejects empty supportedSiteCapabilities', () => {
    expect(() => BrokerDriverSchema.parse({ ...valid, supportedSiteCapabilities: [] })).toThrow();
  });

  it('rejects unknown capability', () => {
    expect(() =>
      BrokerDriverSchema.parse({ ...valid, supportedSiteCapabilities: ['weird-thing'] }),
    ).toThrow();
  });

  it('rejects missing displayName', () => {
    const { displayName: _displayName, ...rest } = valid;
    expect(() => BrokerDriverSchema.parse(rest)).toThrow();
  });

  it('rejects extra fields (strict mode)', () => {
    expect(() => BrokerDriverSchema.parse({ ...valid, extra: 'nope' })).toThrow();
  });

  it('accepts multiple capabilities', () => {
    expect(() =>
      BrokerDriverSchema.parse({
        ...valid,
        supportedSiteCapabilities: ['mqtt-ingest', 'http-webhook'],
      }),
    ).not.toThrow();
  });
});

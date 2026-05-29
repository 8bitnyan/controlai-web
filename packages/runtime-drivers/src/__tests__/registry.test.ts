import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import {
  registerBrokerDriver,
  getBrokerDriver,
  listBrokerDrivers,
  __resetBrokerDriverRegistryForTests,
} from '../registry';
import type { BrokerDriverInstance } from '../schema';

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

function def(id: string, capabilities: string[] = ['mqtt-ingest']) {
  return {
    id,
    displayName: `${id} display`,
    supportedSiteCapabilities: capabilities,
    configSchema: z.object({}).passthrough(),
    factory: () => noopInstance(),
  };
}

describe('broker-driver registry', () => {
  beforeEach(() => __resetBrokerDriverRegistryForTests());

  it('register + get round trip', () => {
    registerBrokerDriver(def('mqtt-driver'));
    expect(getBrokerDriver('mqtt-driver').id).toBe('mqtt-driver');
  });

  it('list returns all registered drivers', () => {
    registerBrokerDriver(def('mqtt-driver'));
    registerBrokerDriver(def('kafka-driver', ['kafka-ingest']));
    expect(listBrokerDrivers()).toHaveLength(2);
  });

  it('list filters by capability', () => {
    registerBrokerDriver(def('mqtt-driver', ['mqtt-ingest']));
    registerBrokerDriver(def('kafka-driver', ['kafka-ingest']));
    expect(listBrokerDrivers({ capability: 'kafka-ingest' })).toHaveLength(1);
    expect(listBrokerDrivers({ capability: 'mqtt-ingest' })).toHaveLength(1);
  });

  it('duplicate id throws with first call site hint', () => {
    registerBrokerDriver(def('mqtt-driver'));
    expect(() => registerBrokerDriver(def('mqtt-driver'))).toThrow(/Duplicate broker-driver id: mqtt-driver/);
  });

  it('getBrokerDriver throws UNKNOWN_BROKER_DRIVER on missing id', () => {
    try {
      getBrokerDriver('nope');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as Error & { code?: string }).code).toBe('UNKNOWN_BROKER_DRIVER');
    }
  });

  it('rejects invalid driver shape at register time', () => {
    expect(() => registerBrokerDriver({ id: 'BAD_ID' })).toThrow();
  });

  it('register accepts multi-capability', () => {
    registerBrokerDriver(def('multi', ['mqtt-ingest', 'http-webhook']));
    expect(listBrokerDrivers({ capability: 'mqtt-ingest' })).toHaveLength(1);
    expect(listBrokerDrivers({ capability: 'http-webhook' })).toHaveLength(1);
  });

  it('reset clears the registry', () => {
    registerBrokerDriver(def('mqtt-driver'));
    __resetBrokerDriverRegistryForTests();
    expect(listBrokerDrivers()).toHaveLength(0);
  });

  it('list with unknown capability returns empty', () => {
    registerBrokerDriver(def('mqtt-driver', ['mqtt-ingest']));
    expect(listBrokerDrivers({ capability: 'kafka-ingest' })).toHaveLength(0);
  });

  it('register returns the parsed def', () => {
    const result = registerBrokerDriver(def('mqtt-driver'));
    expect(result.id).toBe('mqtt-driver');
    expect(result.displayName).toBe('mqtt-driver display');
  });
});

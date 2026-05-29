import { describe, it, expect, beforeAll } from 'vitest';
import { listBrokerDrivers, getBrokerDriver } from '../../src';

// Drivers register at module-load via side-effect imports; once loaded they stay
// in the singleton registry. We import the aggregator once before assertions.
beforeAll(async () => {
  await import('../index');
});

describe('driver aggregator', () => {
  it('registers all v1 drivers via side-effect import', () => {
    const ids = listBrokerDrivers().map((d) => d.id).sort();
    expect(ids).toEqual(
      expect.arrayContaining(['http-webhook-driver', 'kafka-driver', 'mqtt-driver', 'tsdb-direct-driver']),
    );
  });

  it('each driver is resolvable by id after aggregator import', () => {
    expect(getBrokerDriver('mqtt-driver').id).toBe('mqtt-driver');
    expect(getBrokerDriver('kafka-driver').id).toBe('kafka-driver');
    expect(getBrokerDriver('http-webhook-driver').id).toBe('http-webhook-driver');
    expect(getBrokerDriver('tsdb-direct-driver').id).toBe('tsdb-direct-driver');
  });
});

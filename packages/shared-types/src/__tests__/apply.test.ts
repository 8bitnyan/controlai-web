import { describe, it, expect } from 'vitest';
import {
  OP_TYPES,
  OpSchema,
  BrokerDriverIdSchema,
  TopicSchemaModeSchema,
} from '../apply';

describe('apply schema additions for spec 4', () => {
  it('OP_TYPES includes configureDriver and migrateTopicSchema', () => {
    expect(OP_TYPES).toContain('configureDriver');
    expect(OP_TYPES).toContain('migrateTopicSchema');
  });

  it('OpSchema accepts configureDriver op', () => {
    const op = {
      id: 'op-1',
      type: 'configureDriver' as const,
      description: 'configure',
      path: '/v1/drivers',
      method: 'POST' as const,
      body: { siteId: 's1', driverId: 'mqtt-driver' },
    };
    expect(() => OpSchema.parse(op)).not.toThrow();
  });

  it('OpSchema accepts migrateTopicSchema op', () => {
    const op = {
      id: 'op-2',
      type: 'migrateTopicSchema' as const,
      description: 'migrate',
      path: '/v1/topic-schema',
      method: 'PATCH' as const,
      body: { siteGroupId: 'sg1', mode: 'dual' },
    };
    expect(() => OpSchema.parse(op)).not.toThrow();
  });

  it('OpSchema rejects unknown op type', () => {
    expect(() =>
      OpSchema.parse({
        id: 'op-x',
        type: 'wat',
        description: 'd',
        path: '/p',
        method: 'POST',
        body: {},
      }),
    ).toThrow();
  });

  it('BrokerDriverIdSchema accepts valid ids', () => {
    expect(() => BrokerDriverIdSchema.parse('mqtt-driver')).not.toThrow();
    expect(() => BrokerDriverIdSchema.parse('kafka-driver')).not.toThrow();
    expect(() => BrokerDriverIdSchema.parse('http-webhook-driver')).not.toThrow();
  });

  it('BrokerDriverIdSchema rejects invalid ids', () => {
    expect(() => BrokerDriverIdSchema.parse('MQTT-Driver')).toThrow();
    expect(() => BrokerDriverIdSchema.parse('1mqtt')).toThrow();
    expect(() => BrokerDriverIdSchema.parse('mqtt_driver')).toThrow();
    expect(() => BrokerDriverIdSchema.parse('')).toThrow();
  });

  it('TopicSchemaModeSchema accepts legacy/dual/new', () => {
    expect(TopicSchemaModeSchema.parse('legacy')).toBe('legacy');
    expect(TopicSchemaModeSchema.parse('dual')).toBe('dual');
    expect(TopicSchemaModeSchema.parse('new')).toBe('new');
  });

  it('TopicSchemaModeSchema rejects other values', () => {
    expect(() => TopicSchemaModeSchema.parse('hybrid')).toThrow();
  });
});

import { describe, it, expect } from 'vitest';
import { NormalizedMessageSchema } from '../normalized-message';

const cuid = 'cklm1q2r3000a01abcdef1234';

describe('NormalizedMessageSchema', () => {
  it('accepts a valid message', () => {
    expect(() =>
      NormalizedMessageSchema.parse({
        deviceKey: cuid,
        dataType: 'data',
        payload: { value: 42 },
        ts: '2026-05-28T00:00:00.000Z',
        sourceDriver: 'mqtt-driver',
      }),
    ).not.toThrow();
  });

  it('accepts optional sourceTopic', () => {
    expect(() =>
      NormalizedMessageSchema.parse({
        deviceKey: cuid,
        dataType: 'birth',
        payload: {},
        ts: '2026-05-28T00:00:00.000Z',
        sourceTopic: 'modules/g/NBIRTH/abc',
        sourceDriver: 'mqtt-driver',
      }),
    ).not.toThrow();
  });

  it('rejects invalid dataType', () => {
    expect(() =>
      NormalizedMessageSchema.parse({
        deviceKey: cuid,
        dataType: 'huh',
        payload: {},
        ts: '2026-05-28T00:00:00.000Z',
        sourceDriver: 'mqtt-driver',
      }),
    ).toThrow();
  });

  it('rejects missing deviceKey', () => {
    expect(() =>
      NormalizedMessageSchema.parse({
        dataType: 'data',
        payload: {},
        ts: '2026-05-28T00:00:00.000Z',
        sourceDriver: 'mqtt-driver',
      }),
    ).toThrow();
  });

  it('rejects non-cuid deviceKey', () => {
    expect(() =>
      NormalizedMessageSchema.parse({
        deviceKey: 'not-a-cuid',
        dataType: 'data',
        payload: {},
        ts: '2026-05-28T00:00:00.000Z',
        sourceDriver: 'mqtt-driver',
      }),
    ).toThrow();
  });

  it('rejects invalid ts (non-ISO8601)', () => {
    expect(() =>
      NormalizedMessageSchema.parse({
        deviceKey: cuid,
        dataType: 'data',
        payload: {},
        ts: '2026/05/28',
        sourceDriver: 'mqtt-driver',
      }),
    ).toThrow();
  });
});

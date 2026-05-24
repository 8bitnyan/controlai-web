import { describe, it, expect } from 'vitest';
import {
  CONNECTION_MATRIX,
  isValidNodeConnection,
} from '@controlai-web/shared-types';
import type { NodeType } from '@controlai-web/shared-types';

describe('CONNECTION_MATRIX', () => {
  it('defines all 6 node types', () => {
    const expectedTypes: NodeType[] = [
      'sensor', 'gateway', 'broker', 'ingest', 'timescaledb', 'monitoring',
    ];
    for (const type of expectedTypes) {
      expect(CONNECTION_MATRIX).toHaveProperty(type);
    }
  });

  it('monitoring has no outgoing connections (terminal)', () => {
    expect(CONNECTION_MATRIX.monitoring).toHaveLength(0);
  });
});

describe('isValidNodeConnection', () => {
  // ─── Valid connections from the spec ──────────────────────────────────────
  it('sensor → gateway is valid', () => {
    expect(isValidNodeConnection('sensor', 'gateway')).toBe(true);
  });

  it('sensor → broker is valid', () => {
    expect(isValidNodeConnection('sensor', 'broker')).toBe(true);
  });

  it('gateway → broker is valid', () => {
    expect(isValidNodeConnection('gateway', 'broker')).toBe(true);
  });

  it('gateway → ingest is valid', () => {
    expect(isValidNodeConnection('gateway', 'ingest')).toBe(true);
  });

  it('broker → ingest is valid', () => {
    expect(isValidNodeConnection('broker', 'ingest')).toBe(true);
  });

  it('broker → monitoring is valid', () => {
    expect(isValidNodeConnection('broker', 'monitoring')).toBe(true);
  });

  it('ingest → timescaledb is valid', () => {
    expect(isValidNodeConnection('ingest', 'timescaledb')).toBe(true);
  });

  it('ingest → monitoring is valid', () => {
    expect(isValidNodeConnection('ingest', 'monitoring')).toBe(true);
  });

  it('timescaledb → monitoring is valid', () => {
    expect(isValidNodeConnection('timescaledb', 'monitoring')).toBe(true);
  });

  // ─── Invalid connections ──────────────────────────────────────────────────
  it('timescaledb → sensor is INVALID', () => {
    expect(isValidNodeConnection('timescaledb', 'sensor')).toBe(false);
  });

  it('monitoring → anything is INVALID (terminal)', () => {
    const targets: NodeType[] = ['sensor', 'gateway', 'broker', 'ingest', 'timescaledb', 'monitoring'];
    for (const target of targets) {
      expect(isValidNodeConnection('monitoring', target)).toBe(false);
    }
  });

  it('sensor → ingest is INVALID', () => {
    expect(isValidNodeConnection('sensor', 'ingest')).toBe(false);
  });

  it('sensor → timescaledb is INVALID', () => {
    expect(isValidNodeConnection('sensor', 'timescaledb')).toBe(false);
  });

  it('broker → sensor is INVALID', () => {
    expect(isValidNodeConnection('broker', 'sensor')).toBe(false);
  });

  it('ingest → sensor is INVALID', () => {
    expect(isValidNodeConnection('ingest', 'sensor')).toBe(false);
  });

  it('timescaledb → broker is INVALID', () => {
    expect(isValidNodeConnection('timescaledb', 'broker')).toBe(false);
  });
});

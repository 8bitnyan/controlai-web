import { describe, it, expect } from 'vitest';

describe('apply gateway autocreate defaults', () => {
  it('builds simulator gateway upsert payload shape', () => {
    const canvasNodeId = '5b8a33a3-0853-4e0d-a169-7b15c271d22c';
    const payload = {
      label: 'Generic Main Gateway / 범용 메인 게이트웨이',
      kind: 'simulator',
      mode: 'cbor-modules-cloud',
      endpointURL: 'mqtts://ste_x.tnt_x.api.43-203-6-179.sslip.io:8883',
      groupId: 'tnt_x',
      clientId: `gw-${canvasNodeId.slice(0, 8)}`,
      sensors: [],
      desiredState: 'running',
    };

    expect(payload.kind).toBe('simulator');
    expect(payload.mode).toBe('cbor-modules-cloud');
    expect(payload.clientId).toBe('gw-5b8a33a3');
    expect(payload.desiredState).toBe('running');
  });
});

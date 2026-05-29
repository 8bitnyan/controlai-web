import { describe, expect, it, vi } from 'vitest';
import { synthesizePlan } from '../../lib/apply-planner';
import { executeOp } from '../../lib/apply-executor';
import { DaemonError, callDaemon } from '../../lib/daemon-client';

vi.mock('../../lib/daemon-client', async () => {
  const actual = await vi.importActual<typeof import('../../lib/daemon-client')>('../../lib/daemon-client');
  return { ...actual, callDaemon: vi.fn() };
});

describe('apply §7 ops', () => {
  it('synthesizes setBrokerKind/setRetentionDays/setIngestMode in order', () => {
    const plan = synthesizePlan(
      [
        { id: 'broker-1', type: 'device', data: { deviceTypeId: 'core-generic-broker', kind: 'emqx' } },
        { id: 'ingest-1', type: 'device', data: { deviceTypeId: 'core-generic-ingest', direction: 'bi' } },
        { id: 'tsdb-1', type: 'device', data: { deviceTypeId: 'core-generic-tsdb', retentionDays: '30d' } },
      ],
      [{ id: 'e1', source: 'broker-1', target: 'ingest-1' }, { id: 'e2', source: 'broker-1', target: 'tsdb-1' }],
      { tenants: [{ id: 't1' }], sites: [{ id: 's1', tenantId: 't1', broker: { kind: 'mosquitto' }, ingest: { direction: 'uni' } }] },
      't1',
      [{ canvasNodeId: 'broker-1', controlaiTenantId: 't1', controlaiSiteId: 's1' }],
      new Map([['broker-1', { siteId: 's1' }]]),
    );
    expect(plan.ops.map((o) => o.type)).toEqual(['configureDriver', 'setBrokerKind', 'setIngestMode', 'setRetentionDays']);
  });

  it('plan hash stable for unchanged canvas', () => {
    const nodes = [{ id: 'broker-1', type: 'device', data: { deviceTypeId: 'core-generic-broker', kind: 'mosquitto' } }];
    const daemonState = { tenants: [{ id: 't1' }], sites: [{ id: 's1', tenantId: 't1', broker: { kind: 'mosquitto' } }] };
    const existingSites = [{ canvasNodeId: 'broker-1', controlaiTenantId: 't1', controlaiSiteId: 's1' }];
    const devices = new Map([['broker-1', { siteId: 's1' }]]);
    const a = synthesizePlan(nodes, [], daemonState, 't1', existingSites, devices);
    const b = synthesizePlan(nodes, [], daemonState, 't1', existingSites, devices);
    expect(a.planHash).toBe(b.planHash);
    expect(a.ops).toHaveLength(1);
  });

  it('executeOp supports idempotent 409 for new patch ops', async () => {
    vi.mocked(callDaemon).mockRejectedValueOnce(new DaemonError(409, '{}', 'http://x'));
    const out = await executeOp(
      { id: 'o1', type: 'setBrokerKind', description: 'x', path: '/v1/tenants/t1/sites/s1', method: 'PATCH', body: { broker_kind: 'emqx' } } as any,
      { baseURL: 'http://x', bearerTokenEnc: 'enc' },
    );
    expect(out.result.status).toBe('success');
  });
});

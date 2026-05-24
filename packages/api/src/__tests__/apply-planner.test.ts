import { describe, it, expect } from 'vitest';
import { synthesizePlan } from '../lib/apply-planner';

describe('synthesizePlan', () => {
  it('returns empty ops for empty graph', () => {
    const plan = synthesizePlan([], [], { tenants: [], sites: [] });
    expect(plan.ops).toHaveLength(0);
    expect(plan.planId).toBeTruthy();
    expect(plan.planHash).toBeTruthy();
  });

  it('graph with no broker nodes returns empty ops', () => {
    const nodes = [
      { id: 'sensor-1', type: 'sensor', data: { type: 'sensor', device_id: 'dev1', topic_prefix: 'sensors/', qos: '1' } },
    ];
    const plan = synthesizePlan(nodes, [], { tenants: [], sites: [] });
    expect(plan.ops).toHaveLength(0);
  });

  it('broker node with no daemon counterpart → createTenant + createSite + issueCert', () => {
    const nodes = [
      {
        id: 'broker-1',
        type: 'broker',
        data: { type: 'broker', kind: 'mosquitto', throughput: 'low', label: 'Broker' },
      },
    ];

    const plan = synthesizePlan(nodes, [], { tenants: [], sites: [] });

    const opTypes = plan.ops.map((o) => o.type);
    expect(opTypes).toContain('createTenant');
    expect(opTypes).toContain('createSite');
    expect(opTypes).toContain('issueCert');
  });

  it('createSite op body includes broker kind and throughput', () => {
    const nodes = [
      {
        id: 'broker-1',
        type: 'broker',
        data: { type: 'broker', kind: 'mosquitto', throughput: 'low', label: 'Broker' },
      },
    ];

    const plan = synthesizePlan(nodes, [], { tenants: [], sites: [] });

    const createSiteOp = plan.ops.find((o) => o.type === 'createSite');
    expect(createSiteOp).toBeTruthy();
    expect(createSiteOp!.body).toMatchObject({
      broker: { kind: 'mosquitto' },
      throughput: 'low',
    });
  });

  it('existing daemon site matching broker → no createSite op', () => {
    const nodes = [
      {
        id: 'broker-1',
        type: 'broker',
        data: { type: 'broker', kind: 'mosquitto', throughput: 'low', label: 'Broker' },
      },
    ];
    const daemonState = {
      tenants: [{ id: 'tenant-1' }],
      sites: [{ id: 'site-1', tenantId: 'tenant-1', broker: { kind: 'mosquitto' } }],
    };

    const plan = synthesizePlan(nodes, [], daemonState, 'tenant-1');

    const opTypes = plan.ops.map((o) => o.type);
    expect(opTypes).not.toContain('createTenant');
    expect(opTypes).not.toContain('createSite');
  });

  it('timescaledb retention node with existing tenant → updateTsdb op', () => {
    const nodes = [
      {
        id: 'tsdb-1',
        type: 'timescaledb',
        data: { type: 'timescaledb', retention: '7d', label: 'TSDB' },
      },
    ];
    const daemonState = {
      tenants: [{ id: 'tenant-1' }],
      sites: [],
    };

    const plan = synthesizePlan(nodes, [], daemonState, 'tenant-1');

    const updateTsdb = plan.ops.find((o) => o.type === 'updateTsdb');
    expect(updateTsdb).toBeTruthy();
    expect(updateTsdb!.body).toMatchObject({ retention: '7d' });
  });

  it('plan hash is deterministic for same input', () => {
    const nodes = [
      {
        id: 'broker-1',
        type: 'broker',
        data: { type: 'broker', kind: 'emqx', throughput: 'mid', label: 'Broker' },
      },
    ];
    const plan1 = synthesizePlan(nodes, [], { tenants: [], sites: [] });
    const plan2 = synthesizePlan(nodes, [], { tenants: [], sites: [] });
    expect(plan1.planHash).toBe(plan2.planHash);
  });

  it('creates only one createTenant for multiple broker nodes', () => {
    const nodes = [
      { id: 'broker-1', type: 'broker', data: { type: 'broker', kind: 'mosquitto', throughput: 'low', label: 'B1' } },
      { id: 'broker-2', type: 'broker', data: { type: 'broker', kind: 'emqx', throughput: 'mid', label: 'B2' } },
    ];

    const plan = synthesizePlan(nodes, [], { tenants: [], sites: [] });

    const createTenantOps = plan.ops.filter((o) => o.type === 'createTenant');
    expect(createTenantOps).toHaveLength(1);
  });
});

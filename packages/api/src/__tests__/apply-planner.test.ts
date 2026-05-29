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
      { id: 'sensor-1', type: 'sensor', data: { deviceTypeId: 'core-generic-sensor', device_id: 'dev1', topic_prefix: 'sensors/', qos: '1' } },
    ];
    const plan = synthesizePlan(nodes, [], { tenants: [], sites: [] });
    expect(plan.ops).toHaveLength(0);
  });

  it('broker manifest category node branches to broker ops', () => {
    const nodes = [
      {
        id: 'broker-1',
        type: 'broker',
        data: { deviceTypeId: 'core-generic-broker', kind: 'mosquitto', throughput: 'low', label: 'Broker' },
      },
    ];

    const plan = synthesizePlan(nodes, [], { tenants: [], sites: [] });

    const opTypes = plan.ops.map((o) => o.type);
    expect(opTypes.slice(0, 3)).toEqual(['createTenant', 'createSite', 'issueCert']);
  });

  it('createSite op body includes broker kind and throughput', () => {
    const nodes = [
      {
        id: 'broker-1',
        type: 'broker',
        data: { deviceTypeId: 'core-generic-broker', kind: 'mosquitto', throughput: 'low', label: 'Broker' },
      },
    ];

    const plan = synthesizePlan(nodes, [], { tenants: [], sites: [] });

    const createSiteOp = plan.ops.find((o) => o.type === 'createSite');
    expect(createSiteOp).toBeTruthy();
    expect(createSiteOp!.body).toMatchObject({
      broker_kind: 'mosquitto',
      throughput: 'low',
    });
  });

  it('existing daemon site matching broker → no createSite op', () => {
    const nodes = [
      {
        id: 'broker-1',
        type: 'broker',
        data: { deviceTypeId: 'core-generic-broker', kind: 'mosquitto', throughput: 'low', label: 'Broker' },
      },
    ];
    const daemonState = {
      tenants: [{ id: 'tenant-1' }],
      sites: [{ id: 'site-1', tenantId: 'tenant-1', broker: { kind: 'mosquitto' } }],
    };

    const existingSites = [
      { canvasNodeId: 'broker-1', controlaiTenantId: 'tenant-1', controlaiSiteId: 'site-1' },
    ];

    const plan = synthesizePlan(nodes, [], daemonState, 'tenant-1', existingSites);

    const opTypes = plan.ops.map((o) => o.type);
    expect(opTypes).not.toContain('createTenant');
    expect(opTypes).not.toContain('createSite');
  });

  it('tsdb manifest category node branches to setRetentionDays ops', () => {
    const nodes = [
      {
        id: 'tsdb-1',
        type: 'timescaledb',
        data: { deviceTypeId: 'core-generic-tsdb', retention: '7d', label: 'TSDB' },
      },
    ];
    const daemonState = {
      tenants: [{ id: 'tenant-1' }],
      sites: [],
    };

    const edges = [{ id: 'e1', source: 'broker-1', target: 'tsdb-1' }];
    const existingSites = [{ canvasNodeId: 'broker-1', controlaiTenantId: 'tenant-1', controlaiSiteId: 'site-1' }];
    const plan = synthesizePlan([{ id: 'broker-1', type: 'broker', data: { deviceTypeId: 'core-generic-broker' } }, ...nodes], edges, { ...daemonState, sites: [{ id: 'site-1', tenantId: 'tenant-1', retentionPeriod: '1d' }] }, 'tenant-1', existingSites);

    const op = plan.ops.find((o) => o.type === 'setRetentionDays');
    expect(op).toBeTruthy();
    expect(op!.body).toMatchObject({ retention_period: '7d' });
  });

  it('ingest manifest category node branches to setIngestMode ops', () => {
    const nodes = [
      {
        id: 'broker-1',
        type: 'broker',
        data: { deviceTypeId: 'core-generic-broker', kind: 'mosquitto', throughput: 'low', label: 'Broker' },
      },
      {
        id: 'ingest-1',
        type: 'ingest',
        data: { deviceTypeId: 'core-generic-ingest', direction: 'bi', label: 'Ingest' },
      },
    ];
    const edges = [
      { id: 'e1', source: 'broker-1', target: 'ingest-1', sourceHandle: 'ingress' },
    ];
    const daemonState = {
      tenants: [{ id: 'tenant-1' }],
      sites: [{ id: 'site-1', tenantId: 'tenant-1', ingest: { direction: 'uni' } }],
    };
    const existingSites = [
      { canvasNodeId: 'broker-1', controlaiTenantId: 'tenant-1', controlaiSiteId: 'site-1' },
    ];

    const plan = synthesizePlan(nodes, edges, daemonState, 'tenant-1', existingSites);
    const updateIngest = plan.ops.find((o) => o.type === 'setIngestMode');

    expect(updateIngest).toBeTruthy();
    expect(updateIngest!.body).toMatchObject({ direction: 'bi' });
  });

  it('throws for orphan device types before emitting any ops', () => {
    const nodes = [
      {
        id: 'orphan-1',
        type: 'broker',
        data: { deviceTypeId: 'orphan-xyz', kind: 'mosquitto' },
      },
    ];

    let thrown: Error | null = null;
    try {
      synthesizePlan(nodes, [], { tenants: [], sites: [] });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeTruthy();
    expect(thrown!.message).toContain('Plan synthesis blocked: orphan device types present');
  });

  it('plan hash is deterministic for same input', () => {
    const nodes = [
      {
        id: 'broker-1',
        type: 'broker',
        data: { deviceTypeId: 'core-generic-broker', kind: 'emqx', throughput: 'mid', label: 'Broker' },
      },
    ];
    const plan1 = synthesizePlan(nodes, [], { tenants: [], sites: [] });
    const plan2 = synthesizePlan(nodes, [], { tenants: [], sites: [] });
    expect(plan1.planHash).toBe(plan2.planHash);
  });

  it('creates only one createTenant for multiple broker nodes', () => {
    const nodes = [
      { id: 'broker-1', type: 'broker', data: { deviceTypeId: 'core-generic-broker', kind: 'mosquitto', throughput: 'low', label: 'B1' } },
      { id: 'broker-2', type: 'broker', data: { deviceTypeId: 'core-generic-broker', kind: 'emqx', throughput: 'mid', label: 'B2' } },
    ];

    const plan = synthesizePlan(nodes, [], { tenants: [], sites: [] });

    const createTenantOps = plan.ops.filter((o) => o.type === 'createTenant');
    expect(createTenantOps).toHaveLength(1);
  });

  describe('Device binding', () => {
    it('prefers Device.siteId binding for broker node over legacy canvasNodeId site', () => {
      const nodes = [
        {
          id: 'broker-1',
          type: 'broker',
          data: { deviceTypeId: 'core-generic-broker', kind: 'mosquitto', throughput: 'low' },
        },
      ];

      const daemonState = {
        tenants: [{ id: 'tenant-1' }],
        sites: [{ id: 'site-from-device', tenantId: 'tenant-1', broker: { kind: 'mosquitto' } }],
      };

      const existingSites = [
        {
          canvasNodeId: 'broker-1',
          controlaiTenantId: 'tenant-1',
          controlaiSiteId: 'legacy-site-by-canvas-node',
          deviceSiteId: 'site-from-device',
        },
      ];

      const plan = synthesizePlan(nodes, [], daemonState, 'tenant-1', existingSites);
      expect(plan.ops.map((o) => o.type)).not.toContain('createSite');
    });

    it('falls back to legacy canvasNodeId binding when Device.siteId is null', () => {
      const nodes = [
        {
          id: 'broker-legacy',
          type: 'broker',
          data: { deviceTypeId: 'core-generic-broker', kind: 'mosquitto', throughput: 'low' },
        },
      ];

      const daemonState = {
        tenants: [{ id: 'tenant-1' }],
        sites: [{ id: 'legacy-site', tenantId: 'tenant-1', broker: { kind: 'mosquitto' } }],
      };

      const existingSites = [
        {
          canvasNodeId: 'broker-legacy',
          controlaiTenantId: 'tenant-1',
          controlaiSiteId: 'legacy-site',
          deviceSiteId: null,
        },
      ];

      const plan = synthesizePlan(nodes, [], daemonState, 'tenant-1', existingSites);
      expect(plan.ops.map((o) => o.type)).not.toContain('createSite');
    });

    it('includes post-commit Device.siteId update op after createSite', () => {
      const nodes = [
        {
          id: 'broker-new',
          type: 'broker',
          data: { deviceTypeId: 'core-generic-broker', kind: 'mosquitto', throughput: 'low' },
        },
      ];

      const plan = synthesizePlan(nodes, [], { tenants: [], sites: [] }, undefined, []);
      expect(plan.ops.map((o) => o.type)).toContain('bindDeviceSite');
    });

    it('propagates site binding recursively through parentDeviceKey descendants', () => {
      const nodes = [
        { id: 'broker-root', type: 'broker', data: { deviceTypeId: 'core-generic-broker', kind: 'mosquitto' } },
        { id: 'sensor-child', type: 'sensor', data: { deviceTypeId: 'core-generic-sensor' } },
      ];

      const edges = [{ id: 'e-1', source: 'broker-root', target: 'sensor-child' }];
      const plan = synthesizePlan(nodes, edges, { tenants: [], sites: [] }, undefined, []);
      expect(plan.ops.some((o) => o.type === 'bindDeviceSiteDescendants')).toBe(true);
    });
  });
});

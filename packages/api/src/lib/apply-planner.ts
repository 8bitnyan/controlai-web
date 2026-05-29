/**
 * Pure function: synthesize an ordered list of daemon API ops from a NodeConfig graph
 * vs. current daemon state. No side effects.
 */
import { createHash, randomUUID } from 'crypto';
import type { Op, OpType } from '@controlai-web/shared-types';
import { getDeviceType } from '@controlai-web/shared-types';

export interface GraphNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface DaemonTenant {
  id: string;
  name?: string;
}

export interface DaemonSite {
  id: string;
  tenantId: string;
  broker?: { kind: string };
  ingest?: { direction: string; batch_size?: number };
  throughput?: string;
}

export interface DaemonState {
  tenants: DaemonTenant[];
  sites: DaemonSite[];
}

export interface Plan {
  planId: string;
  planHash: string;
  ops: Op[];
}

function makeOp(
  type: OpType,
  description: string,
  path: string,
  method: 'POST' | 'PATCH' | 'PUT',
  body: Record<string, unknown>,
  nodeId?: string,
): Op {
  return {
    id: randomUUID(),
    type,
    description,
    path,
    method,
    body,
    nodeId,
  };
}

/**
 * Synthesize the Apply plan per design.md algorithm.
 *
 * Input: nodes + edges from NodeConfig, current daemon state.
 * Output: Plan { ops, planHash } — ordered as:
 *   createTenant → createSite → issueCert → updateIngest → updateTsdb
 */
export function synthesizePlan(
  nodes: GraphNode[],
  edges: GraphEdge[],
  daemonState: DaemonState,
  existingTenantId?: string | null,
  existingSites: Array<{
    canvasNodeId: string | null;
    controlaiTenantId: string | null;
    controlaiSiteId: string | null;
    deviceSiteId?: string | null;
  }> = [],
  devicesByCanvasNodeId?: Map<string, { siteId: string | null }>,
): Plan {
  const ops: Op[] = [];

  const orphanNodes = nodes.filter((node) => {
    const deviceTypeId = node.data?.deviceTypeId;
    return typeof deviceTypeId !== 'string' || !getDeviceType(deviceTypeId);
  });
  if (orphanNodes.length > 0) {
    throw new Error(
      `Plan synthesis blocked: orphan device types present (count=${orphanNodes.length})`,
    );
  }

  const brokerNodes = nodes.filter(
    (n) => getDeviceType(n.data?.deviceTypeId as string)?.category === 'broker',
  );
  const ingestNodes = nodes.filter(
    (n) => getDeviceType(n.data?.deviceTypeId as string)?.category === 'ingest',
  );
  const timescaleNodes = nodes.filter(
    (n) => getDeviceType(n.data?.deviceTypeId as string)?.category === 'tsdb',
  );

  // Prefer the project-pinned tenant id, then fall back to the first tenant
  // the daemon reports. Either resolves the :tenantId placeholder for ops that
  // skip createTenant.
  const resolvedTenantId =
    existingTenantId ?? daemonState.tenants[0]?.id ?? null;
  const hasDaemonTenant = daemonState.tenants.length > 0;
  const tenantPathSeg = resolvedTenantId ?? ':tenantId';

  // Step 1: For each Broker node — if no site row is bound to this broker node,
  // add createTenant + createSite. This replaces old broker.kind matching so
  // multiple same-kind brokers can coexist in one SiteGroup.
  for (const broker of brokerNodes) {
    const data = broker.data as { kind?: string; throughput?: string };
    const kind = data.kind ?? 'mosquitto';
    const throughput = data.throughput ?? 'low';

    const matchingExistingSite = existingSites.find((s) => s.canvasNodeId === broker.id);
    const preferredDeviceSiteId =
      devicesByCanvasNodeId?.get(broker.id)?.siteId ?? matchingExistingSite?.deviceSiteId ?? null;
    const matchingSite =
      matchingExistingSite?.controlaiTenantId && preferredDeviceSiteId
        ? daemonState.sites.find(
            (s) =>
              s.tenantId === matchingExistingSite.controlaiTenantId &&
              s.id === preferredDeviceSiteId,
          )
        : matchingExistingSite?.controlaiTenantId && matchingExistingSite.controlaiSiteId
        ? daemonState.sites.find(
            (s) =>
              s.tenantId === matchingExistingSite.controlaiTenantId &&
              s.id === matchingExistingSite.controlaiSiteId,
          )
        : null;

    if (!matchingSite) {
      // Need to create tenant first (only once)
      if (!hasDaemonTenant && !ops.some((o) => o.type === 'createTenant')) {
        ops.push(
          makeOp(
            'createTenant',
            'Create daemon tenant',
            '/v1/tenants',
            'POST',
            { slug: 'default' },
            broker.id,
          ),
        );
      }

      // Find ingest node connected to this broker
      const ingestEdge = edges.find(
        (e) => e.source === broker.id && e.sourceHandle === 'ingress',
      ) ?? edges.find(
        (e) => e.source === broker.id,
      );
      const connectedIngest = ingestEdge
        ? ingestNodes.find((n) => n.id === ingestEdge.target)
        : ingestNodes[0];

      const ingestData = connectedIngest?.data as
        | { direction?: string; batch_size?: number }
        | undefined;
      const direction = ingestData?.direction ?? 'uni';

      // Derive a deterministic site slug from the broker node id.
      // Daemon constraints: ^[a-z][a-z0-9-]{0,40}$
      const siteSlug = ('s' + broker.id.toLowerCase().replace(/[^a-z0-9-]+/g, '-'))
        .replace(/-+/g, '-')
        .replace(/-+$/g, '')
        .slice(0, 41);

      ops.push(
        makeOp(
          'createSite',
          `Create daemon site (broker: ${kind}, throughput: ${throughput})`,
          `/v1/tenants/${tenantPathSeg}/sites`,
          'POST',
          {
            slug: siteSlug,
            broker_kind: kind,
            throughput,
            direction,
            payload_codec: 'cbor',
          },
          broker.id,
        ),
      );
      // We intentionally use op.nodeId to thread the broker canvas node id
      // through commit so the Site row can be upserted by node binding.

      ops.push(
        makeOp(
          'issueCert',
          'Issue mTLS client certificate for mqtt-bridge',
          `/v1/tenants/${tenantPathSeg}/sites/:siteId/pki/certs`,
          'POST',
          { gateway: 'mqtt-bridge' },
          broker.id,
        ),
      );

      ops.push(
        makeOp(
          'bindDeviceSite',
          'Bind broker Device to created Site',
          '/internal/device-site-bind',
          'POST',
          {},
          broker.id,
        ),
      );

      ops.push(
        makeOp(
          'bindDeviceSiteDescendants',
          'Propagate Site binding to Device descendants',
          '/internal/device-site-bind/descendants',
          'POST',
          {},
          broker.id,
        ),
      );
    }

    // configureDriver op — per broker node, push driver config so the orchestrator
    // can hot-reload the BrokerDriverInstance for this Site.
    const brokerData = broker.data as {
      driverId?: string;
      driverConfig?: Record<string, unknown>;
    };
    const driverId = brokerData.driverId ?? 'mqtt-driver';
    ops.push(
      makeOp(
        'configureDriver',
        `Configure broker driver: ${driverId}`,
        '/internal/configure-driver',
        'POST',
        { driverId, driverConfig: brokerData.driverConfig ?? {} },
        broker.id,
      ),
    );
  }

  // Step 2: Ingest config diffs
  for (const ingest of ingestNodes) {
    const data = ingest.data as { direction?: string; batch_size?: number };
    const direction = data.direction ?? 'uni';

    // Find the broker this ingest connects to
    const brokerEdge = edges.find((e) => e.target === ingest.id);
    const connectedBroker = brokerEdge
      ? brokerNodes.find((n) => n.id === brokerEdge.source)
      : null;

    if (connectedBroker) {
      const boundExistingSite = existingSites.find(
        (s) => s.canvasNodeId === connectedBroker.id,
      );
      const preferredDeviceSiteId =
        devicesByCanvasNodeId?.get(connectedBroker.id)?.siteId ??
        boundExistingSite?.deviceSiteId ??
        null;
      const existingSite =
        boundExistingSite?.controlaiTenantId && preferredDeviceSiteId
          ? daemonState.sites.find(
              (s) =>
                s.tenantId === boundExistingSite.controlaiTenantId &&
                s.id === preferredDeviceSiteId,
            )
          : boundExistingSite?.controlaiTenantId && boundExistingSite.controlaiSiteId
            ? daemonState.sites.find(
                (s) =>
                  s.tenantId === boundExistingSite.controlaiTenantId &&
                  s.id === boundExistingSite.controlaiSiteId,
              )
            : null;
      if (
        existingSite &&
        existingSite.ingest?.direction !== direction
      ) {
        ops.push(
          makeOp(
            'updateIngest',
            `Update ingest config (direction: ${direction})`,
            `/v1/tenants/${existingSite.tenantId}/sites/${existingSite.id}`,
            'PATCH',
            { direction },
            ingest.id,
          ),
        );
      }
    }
  }

  // Step 3: TimescaleDB retention diffs
  for (const tsdb of timescaleNodes) {
    const data = tsdb.data as { retention?: string };
    const retention = data.retention ?? '1d';

    if (resolvedTenantId && daemonState.tenants.length > 0) {
      ops.push(
        makeOp(
          'updateTsdb',
          `Update TimescaleDB retention to ${retention}`,
          `/v1/tenants/${tenantPathSeg}`,
          'PATCH',
          { retention },
          tsdb.id,
        ),
      );
    }
  }

  // Step 4: Topic-schema mode migrations
  // When any canvas node sets `targetTopicSchemaMode` (e.g. via canvas toolbar
  // admin action), emit a migrateTopicSchema op for the SiteGroup.
  const schemaTargets = nodes
    .map((n) => (n.data as { targetTopicSchemaMode?: string } | undefined)?.targetTopicSchemaMode)
    .filter((v): v is string => Boolean(v));
  if (schemaTargets.length > 0) {
    const mode = schemaTargets[0];
    ops.push(
      makeOp(
        'migrateTopicSchema',
        `Migrate topic schema to ${mode}`,
        '/internal/migrate-topic-schema',
        'POST',
        { mode },
      ),
    );
  }

  // Compute planHash
  const sortedOps = [...ops].sort((a, b) => a.type.localeCompare(b.type));
  const planHash = createHash('sha256')
    .update(JSON.stringify(sortedOps.map((o) => ({ type: o.type, path: o.path, body: o.body }))))
    .digest('hex');

  return {
    planId: randomUUID(),
    planHash,
    ops,
  };
}

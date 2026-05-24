/**
 * Pure function: synthesize an ordered list of daemon API ops from a NodeConfig graph
 * vs. current daemon state. No side effects.
 */
import { createHash, randomUUID } from 'crypto';
import type { Op, OpType } from '@controlai-web/shared-types';

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
): Plan {
  const ops: Op[] = [];

  const brokerNodes = nodes.filter((n) => n.type === 'broker');
  const ingestNodes = nodes.filter((n) => n.type === 'ingest');
  const timescaleNodes = nodes.filter((n) => n.type === 'timescaledb');

  // Prefer the project-pinned tenant id, then fall back to the first tenant
  // the daemon reports. Either resolves the :tenantId placeholder for ops that
  // skip createTenant.
  const resolvedTenantId =
    existingTenantId ?? daemonState.tenants[0]?.id ?? null;
  const hasDaemonTenant = daemonState.tenants.length > 0;
  const tenantPathSeg = resolvedTenantId ?? ':tenantId';

  // Step 1: For each Broker node — if no daemon site exists, add createTenant + createSite
  for (const broker of brokerNodes) {
    const data = broker.data as { kind?: string; throughput?: string };
    const kind = data.kind ?? 'mosquitto';
    const throughput = data.throughput ?? 'low';

    const matchingSite = daemonState.sites.find(
      (s) => s.broker?.kind === kind,
    );

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
    }
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
      const existingSite = daemonState.sites.find(
        (s) =>
          s.broker?.kind ===
          ((connectedBroker.data as { kind?: string }).kind ?? 'mosquitto'),
      );
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

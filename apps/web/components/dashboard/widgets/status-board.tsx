'use client';

import { trpc } from '@/lib/trpc/client';
import { useCanvasStore } from '@/stores/canvas-store';
import type { NodeData, NodeStatus } from '@controlai-web/shared-types';
import { cn } from '@/lib/utils';

interface StatusBoardProps {
  orgId: string;
  siteGroupId: string;
}

const STATUS_COLORS: Record<NodeStatus, string> = {
  UNKNOWN: 'bg-gray-400',
  HEALTHY: 'bg-green-500',
  DEGRADED: 'bg-yellow-500',
  UNREACHABLE: 'bg-red-500',
};

const NODE_ICONS: Record<string, string> = {
  sensor: '📡',
  gateway: '🔀',
  broker: '📨',
  ingest: '⬇️',
  timescaledb: '🗄️',
  monitoring: '📊',
};

export function StatusBoard({ orgId, siteGroupId }: StatusBoardProps) {
  // Get nodes from the canvas store (already has live telemetry overlaid)
  const nodes = useCanvasStore((s) => s.nodes);

  // Fallback: load from tRPC if store is empty
  // Narrow type to avoid TS2589 deep inference
  const { data: rawNodeConfig } = trpc.nodeConfig.load.useQuery(
    { orgId, siteGroupId },
    { enabled: nodes.length === 0 },
  );
  const nodeConfig = rawNodeConfig as { nodes: unknown } | null | undefined;

  const displayNodes = nodes.length > 0
    ? nodes
    : ((nodeConfig?.nodes as Array<{ id: string; type: string; data: NodeData }> | undefined) ?? []);

  if (displayNodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No nodes in active configuration
      </div>
    );
  }

  return (
    <div className="grid h-full auto-rows-min gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))' }}>
      {displayNodes.map((node) => {
        const data = node.data as NodeData & { status?: NodeStatus };
        const status: NodeStatus = data.status ?? 'UNKNOWN';
        return (
          <div
            key={node.id}
            className="flex flex-col items-center justify-center gap-1 rounded-lg border p-2 text-center"
            role="status"
            aria-label={`${data.label ?? node.type ?? 'node'}: ${status}`}
          >
            <span className="text-xl" aria-hidden>{NODE_ICONS[node.type ?? ''] ?? '❓'}</span>
            <span className="text-xs font-medium truncate max-w-full leading-tight">
              {data.label ?? node.type ?? 'node'}
            </span>
            <span
              className={cn('h-2.5 w-2.5 rounded-full border border-white shadow-sm', STATUS_COLORS[status])}
              aria-label={status}
            />
          </div>
        );
      })}
    </div>
  );
}

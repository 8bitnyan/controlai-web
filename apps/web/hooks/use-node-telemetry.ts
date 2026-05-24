'use client';

import { useCanvasStore } from '@/stores/canvas-store';
import type { NodeStatus } from '@controlai-web/shared-types';

interface NodeTelemetry {
  status: NodeStatus;
  msgPerSec: number;
}

/**
 * Subscribe to live telemetry for a specific nodeId from the canvas store.
 * The canvas store is updated by useSiteStream → updateNodeTelemetry (throttled at store level).
 */
export function useNodeTelemetry(nodeId: string): NodeTelemetry {
  const node = useCanvasStore((s) => s.nodes.find((n) => n.id === nodeId));

  return {
    status: (node?.data?.status as NodeStatus) ?? 'UNKNOWN',
    msgPerSec: (node?.data?.msgPerSec as number) ?? 0,
  };
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  type Node,
  type Edge,
  type NodeTypes,
  type Connection,
  type IsValidConnection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toast } from 'sonner';
import { useCanvasStore } from '@/stores/canvas-store';
import { isValidConnection as checkConnectionValid } from './connection-rules';
import type { NodeData, NodeType } from '@controlai-web/shared-types';
import { defaultNodeData } from '@controlai-web/shared-types';
import { SensorNode } from './nodes/sensor-node';
import { GatewayNode } from './nodes/gateway-node';
import { BrokerNode } from './nodes/broker-node';
import { IngestNode } from './nodes/ingest-node';
import { TimescaleDBNode } from './nodes/timescaledb-node';
import { MonitoringNode } from './nodes/monitoring-node';
import { NodePalette } from './node-palette';
import { ApplyModal } from './apply-modal';
import { CanvasContextProvider } from './canvas-context';
import { trpc } from '@/lib/trpc/client';
import { RotateCcw, RotateCw, Trash2, Maximize2, Wifi, WifiOff, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSiteStream } from '@/hooks/use-site-stream';

/* eslint-disable @typescript-eslint/no-explicit-any */
const NODE_TYPES: NodeTypes = {
  sensor: SensorNode as any,
  gateway: GatewayNode as any,
  broker: BrokerNode as any,
  ingest: IngestNode as any,
  timescaledb: TimescaleDBNode as any,
  monitoring: MonitoringNode as any,
};
/* eslint-enable @typescript-eslint/no-explicit-any */

interface CanvasProps {
  orgId: string;
  projectId: string;
  siteGroupId: string;
  siteId?: string; // for SSE telemetry
}

export function Canvas({ orgId, projectId: _projectId, siteGroupId, siteId }: CanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, deleteElements, fitView } = useReactFlow();

  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    undo,
    redo,
    canUndo,
    canRedo,
    isDirty,
    lastSaved,
    markSaved,
    loadConfig,
    sseStatus,
    setSseStatus,
    updateNodeTelemetry,
  } = useCanvasStore();

  // Load initial config — narrow type to avoid TS2589 deep inference in useEffect deps
  const { data: rawNodeConfig } = trpc.nodeConfig.load.useQuery({ orgId, siteGroupId });
  const nodeConfig = rawNodeConfig as { nodes: unknown; edges: unknown } | null | undefined;

  useEffect(() => {
    if (nodeConfig) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      loadConfig((nodeConfig.nodes as any[]) ?? [], (nodeConfig.edges as any[]) ?? []);
    }
    // loadConfig is stable from Zustand create(); omit to prevent deep type inference
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeConfig]);

  // Autosave: 30s after last change
  const saveMutation = trpc.nodeConfig.save.useMutation({
    onSuccess: () => markSaved(),
  });

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isDirty) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveMutation.mutate({
        orgId,
        siteGroupId,
        nodes: nodes as unknown as unknown[],
        edges: edges as unknown[],
      });
    }, 30_000);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [isDirty, nodes, edges, orgId, siteGroupId, saveMutation]);

  const handleManualSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    saveMutation.mutate({
      orgId,
      siteGroupId,
      nodes: nodes as unknown as unknown[],
      edges: edges as unknown[],
    });
  }, [nodes, edges, orgId, siteGroupId, saveMutation]);

  // SSE telemetry
  const siteStreamSiteId = siteId ?? '';
  useSiteStream({
    orgId,
    siteId: siteStreamSiteId,
    enabled: !!siteId,
    onMessage: (msg) => {
      if (msg.nodeId && msg.status) {
        updateNodeTelemetry(msg.nodeId, msg.status, msg.msgPerSec ?? 0);
      }
    },
    onStatusChange: setSseStatus,
  });

  // Connection validation
  const handleIsValidConnection = useCallback<IsValidConnection>(
    (connection) => {
      const valid = checkConnectionValid(connection as Connection, nodes as Node<NodeData>[]);
      if (!valid) {
        const sourceNode = nodes.find((n) => n.id === connection.source);
        const targetNode = nodes.find((n) => n.id === connection.target);
        if (sourceNode && targetNode) {
          toast.error(
            `Cannot connect ${sourceNode.type ?? '?'} → ${targetNode.type ?? '?'}`,
          );
        }
      }
      return valid;
    },
    [nodes],
  );

  // Drag-and-drop from palette
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const nodeType = event.dataTransfer.getData('application/reactflow-nodetype') as NodeType;
      if (!nodeType) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: Node<NodeData> = {
        id: crypto.randomUUID(),
        type: nodeType,
        position,
        data: defaultNodeData(nodeType),
      };

      addNode(newNode);
    },
    [screenToFlowPosition, addNode],
  );

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if (meta && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  const selectedNodes = nodes.filter((n) => n.selected);
  const selectedEdges = edges.filter((e) => (e as Edge & { selected?: boolean }).selected);

  function handleDelete() {
    deleteElements({ nodes: selectedNodes, edges: selectedEdges });
  }

  // ApplyRun status for toolbar
  const { data: applyStatus } = trpc.provision.status.useQuery({ orgId, siteGroupId });

  // Controlled Apply modal state (shared by Apply button + Re-run button)
  const [applyOpen, setApplyOpen] = useState(false);

  return (
    <CanvasContextProvider orgId={orgId} siteGroupId={siteGroupId}>
    <>
    <div className="flex h-full min-h-[600px] flex-col gap-0">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b bg-background px-3 py-2 gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={undo}
            disabled={!canUndo}
            title="Undo (⌘Z)"
            aria-label="Undo"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={redo}
            disabled={!canRedo}
            title="Redo (⌘⇧Z)"
            aria-label="Redo"
          >
            <RotateCw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={selectedNodes.length === 0 && selectedEdges.length === 0}
            title="Delete selected"
            aria-label="Delete selected"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fitView({ padding: 0.2 })}
            title="Fit view"
            aria-label="Fit view"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-3">
          {/* Save status */}
          <span className="text-xs text-muted-foreground">
            {isDirty ? 'Unsaved changes' : lastSaved ? `Saved ${formatRelative(lastSaved)}` : ''}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleManualSave}
            disabled={!isDirty || saveMutation.isPending}
            title="Save now (⌘S)"
            aria-label="Save now"
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            <span className="ml-1">Save</span>
          </Button>

          {/* Apply run status */}
          {applyStatus && (
            <span
              className={cn(
                'text-xs font-medium',
                applyStatus.success ? 'text-green-600' : 'text-red-600',
              )}
            >
              {applyStatus.success
                ? `Last applied: ${formatRelative(new Date(applyStatus.createdAt))}`
                : 'Last apply failed'}
            </span>
          )}
          {/* Re-run button when last apply failed */}
          {applyStatus && !applyStatus.success && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setApplyOpen(true)}
              aria-label="Re-run apply"
            >
              Re-run
            </Button>
          )}

          {/* SSE status */}
          <span
            className={cn(
              'flex items-center gap-1 text-xs',
              sseStatus === 'connected' && 'text-green-600',
              sseStatus === 'connecting' && 'text-yellow-600',
              (sseStatus === 'disconnected' || sseStatus === 'error') && 'text-gray-400',
            )}
            aria-label={`SSE: ${sseStatus}`}
          >
            {sseStatus === 'connected' && <Wifi className="h-3 w-3" />}
            {sseStatus === 'connecting' && <Loader2 className="h-3 w-3 animate-spin" />}
            {(sseStatus === 'disconnected' || sseStatus === 'error') && <WifiOff className="h-3 w-3" />}
            {sseStatus === 'connected' ? 'Live' : sseStatus === 'connecting' ? 'Connecting…' : 'Disconnected'}
          </span>

          <Button size="sm" onClick={() => setApplyOpen(true)} aria-label="Apply pipeline configuration">
            Apply
          </Button>
        </div>
      </div>

      {/* Canvas area with sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left palette */}
        <div className="p-2">
          <NodePalette />
        </div>

        {/* Flow canvas */}
        <div
          ref={reactFlowWrapper}
          className="relative flex-1"
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          {/* Empty state hint — shown when canvas has no nodes */}
          {nodes.length === 0 && (
            <div
              className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
              aria-hidden
            >
              <p className="rounded-lg border border-dashed bg-background/80 px-6 py-4 text-sm text-muted-foreground backdrop-blur-sm">
                Drag node types from the panel to start
              </p>
            </div>
          )}
          <ReactFlow
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            nodes={nodes as any}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={handleIsValidConnection}
            nodeTypes={NODE_TYPES}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls aria-label="Canvas controls" />
            <MiniMap nodeBorderRadius={8} aria-label="Mini map" />
          </ReactFlow>
        </div>
      </div>
    </div>

    {/* Apply modal — controlled from toolbar Apply + Re-run buttons */}
    <ApplyModal
      open={applyOpen}
      onClose={() => setApplyOpen(false)}
      orgId={orgId}
      siteGroupId={siteGroupId}
    />
    </>
    </CanvasContextProvider>
  );
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

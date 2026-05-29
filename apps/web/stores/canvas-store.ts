'use client';

import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  addEdge,
} from '@xyflow/react';
import {
  assertKnownDeviceType,
  defaultNodeData,
  getDeviceType,
} from '@controlai-web/shared-types';
import type { NodeData } from '@controlai-web/shared-types';

const MAX_HISTORY = 50;
type ManifestCanvasNodeData = {
  deviceTypeId?: string;
  category?: string;
  label?: string;
  visual?: { iconRef?: string; accentColor?: string };
  config?: Record<string, unknown>;
  status?: string;
  msgPerSec?: number;
  lastMessage?: { topic: string; summary: string; ts: number; source: 'sim' | 'board' } | null;
  __orphan?: boolean;
  [k: string]: unknown;
};
type CanvasNodeData = NodeData | ManifestCanvasNodeData;

interface HistoryEntry {
  nodes: Node<CanvasNodeData>[];
  edges: Edge[];
}

export type DeviceRow = {
  deviceKey: string;
  deviceTypeId: string;
  registrationState: 'UNREGISTERED' | 'REGISTERING' | 'REGISTERED' | 'ORPHANED';
  realUuid?: string | null;
  shadowUuid: string;
  parentDeviceKey?: string | null;
  siteId?: string | null;
  simulationDesired: boolean;
  config: Record<string, unknown>;
  telemetry?: SignalValue[];
};

export type SignalValue = { ts: number; value: number };

interface CanvasState {
  nodes: Node<CanvasNodeData>[];
  edges: Edge[];
  past: HistoryEntry[];
  future: HistoryEntry[];
  isDirty: boolean;
  lastSaved: Date | null;
  sseStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
  nodeDevices: Map<string, DeviceRow>;

  // Graph mutations (push to history)
  setNodes: (nodes: Node<CanvasNodeData>[]) => void;
  setEdges: (edges: Edge[]) => void;
  onNodesChange: (changes: NodeChange<Node<CanvasNodeData>>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (deviceTypeId: string, position: { x: number; y: number }) => void;
  updateNodeData: (nodeId: string, data: Partial<CanvasNodeData>) => void;
  replaceDeviceType: (nodeId: string, newDeviceTypeId: string) => void;
  insertAutoCreatedNode: (
    spec: { deviceTypeId: string; parentNodeId: string; label: string },
    gatewayPosition: { x: number; y: number },
    idx: number,
  ) => string;

  // Undo/redo
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  // Persistence state
  markSaved: () => void;
  markDirty: () => void;

  // Telemetry overlays — throttled, no history
  updateNodeTelemetry: (nodeId: string, status: string, msgPerSec: number, value?: SignalValue) => void;
  updateNodeLastMessage: (nodeId: string, msg: { topic: string; summary: string; ts: number; source: 'sim' | 'board' }) => void;

  // SSE status
  setSseStatus: (status: 'disconnected' | 'connecting' | 'connected' | 'error') => void;

  // Load from server
  loadConfig: (nodes: Node<CanvasNodeData>[], edges: Edge[]) => void;

  // Device map state
  setNodeDevice: (canvasNodeId: string, device: DeviceRow) => void;
  removeNodeDevice: (canvasNodeId: string) => void;
  bulkSetNodeDevices: (devices: Array<{ canvasNodeId: string; device: DeviceRow }>) => void;

  // Device selectors
  getDeviceByCanvasNodeId: (canvasNodeId: string) => DeviceRow | undefined;
  getDevicesBySimulationDesired: () => {
    allDesired: boolean;
    allNotDesired: boolean;
    mixed: boolean;
  };
}

function snapshot(state: { nodes: Node<CanvasNodeData>[]; edges: Edge[] }): HistoryEntry {
  return { nodes: [...state.nodes], edges: [...state.edges] };
}

function pushHistory(
  past: HistoryEntry[],
  current: HistoryEntry,
): HistoryEntry[] {
  const next = [...past, current];
  if (next.length > MAX_HISTORY) next.shift();
  return next;
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  nodes: [],
  edges: [],
  past: [],
  future: [],
  isDirty: false,
  lastSaved: null,
  sseStatus: 'disconnected',
  nodeDevices: new Map(),
  canUndo: false,
  canRedo: false,

  setNodes: (nodes) => {
    const state = get();
    set({
      past: pushHistory(state.past, snapshot(state)),
      future: [],
      nodes,
      isDirty: true,
      canUndo: true,
      canRedo: false,
    });
  },

  setEdges: (edges) => {
    const state = get();
    set({
      past: pushHistory(state.past, snapshot(state)),
      future: [],
      edges,
      isDirty: true,
      canUndo: true,
      canRedo: false,
    });
  },

  onNodesChange: (changes) => {
    const state = get();
    const newNodes = applyNodeChanges(changes, state.nodes) as Node<NodeData>[];
    // Only push to history for structural changes (add/remove), not position drags
    const structural = changes.some((c) => c.type === 'add' || c.type === 'remove');
    if (structural) {
      set({
        past: pushHistory(state.past, snapshot(state)),
        future: [],
        nodes: newNodes,
        isDirty: true,
        canUndo: true,
        canRedo: false,
      });
    } else {
      set({ nodes: newNodes, isDirty: true });
    }
  },

  onEdgesChange: (changes) => {
    const state = get();
    const newEdges = applyEdgeChanges(changes, state.edges);
    const structural = changes.some((c) => c.type === 'add' || c.type === 'remove');
    if (structural) {
      set({
        past: pushHistory(state.past, snapshot(state)),
        future: [],
        edges: newEdges,
        isDirty: true,
        canUndo: true,
        canRedo: false,
      });
    } else {
      set({ edges: newEdges, isDirty: true });
    }
  },

  onConnect: (connection) => {
    const state = get();
    const newEdges = addEdge({ ...connection, animated: false }, state.edges);
    set({
      past: pushHistory(state.past, snapshot(state)),
      future: [],
      edges: newEdges,
      isDirty: true,
      canUndo: true,
      canRedo: false,
    });
  },

  addNode: (deviceTypeOrNode, position) => {
    const state = get();
    const node: Node<CanvasNodeData> =
      typeof deviceTypeOrNode === 'string'
        ? (() => {
            assertKnownDeviceType(deviceTypeOrNode);
            const manifest = getDeviceType(deviceTypeOrNode)!;
            return {
              id: crypto.randomUUID(),
              type: manifest.category,
              position: position!,
              data: defaultNodeData(deviceTypeOrNode),
            };
          })()
        : deviceTypeOrNode;
    const newNodes = [...state.nodes, node];
    set({
      past: pushHistory(state.past, snapshot(state)),
      future: [],
      nodes: newNodes,
      isDirty: true,
      canUndo: true,
      canRedo: false,
    });
  },

  updateNodeData: (nodeId, data) => {
    const state = get();
    const newNodes = state.nodes.map((n) =>
      n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n,
    );
    set({
      past: pushHistory(state.past, snapshot(state)),
      future: [],
      nodes: newNodes,
      isDirty: true,
      canUndo: true,
      canRedo: false,
    });
  },

  replaceDeviceType: (nodeId, newDeviceTypeId) => {
    const state = get();
    assertKnownDeviceType(newDeviceTypeId);
    const manifest = getDeviceType(newDeviceTypeId)!;
    const newNodes = state.nodes.map((n) =>
      n.id === nodeId
        ? {
            ...n,
            type: manifest.category,
            data: {
              ...n.data,
              deviceTypeId: newDeviceTypeId,
              __orphan: false,
            },
          }
        : n,
    );
    set({
      past: pushHistory(state.past, snapshot(state)),
      future: [],
      nodes: newNodes,
      isDirty: true,
      canUndo: true,
      canRedo: false,
    });
  },

  insertAutoCreatedNode: (spec, gatewayPosition, idx) => {
    const state = get();
    assertKnownDeviceType(spec.deviceTypeId);
    const manifest = getDeviceType(spec.deviceTypeId)!;
    const canvasNodeId = crypto.randomUUID();
    const node: Node<CanvasNodeData> = {
      id: canvasNodeId,
      type: manifest.category,
      position: {
        x: gatewayPosition.x + 200 + idx * 40,
        y: gatewayPosition.y + 100 + idx * 40,
      },
      data: {
        ...defaultNodeData(spec.deviceTypeId),
        label: spec.label,
      },
    };
    const edge: Edge = {
      id: `${spec.parentNodeId}-${canvasNodeId}`,
      source: spec.parentNodeId,
      target: canvasNodeId,
      animated: false,
    };

    set({
      past: pushHistory(state.past, snapshot(state)),
      future: [],
      nodes: [...state.nodes, node],
      edges: [...state.edges, edge],
      isDirty: true,
      canUndo: true,
      canRedo: false,
    });

    return canvasNodeId;
  },

  undo: () => {
    const { past, nodes, edges, future } = get();
    if (past.length === 0) return;
    const prev = past[past.length - 1]!;
    const newPast = past.slice(0, -1);
    const newFuture = [{ nodes: [...nodes], edges: [...edges] }, ...future];
    set({
      nodes: prev.nodes,
      edges: prev.edges,
      past: newPast,
      future: newFuture,
      isDirty: true,
      canUndo: newPast.length > 0,
      canRedo: true,
    });
  },

  redo: () => {
    const { future, nodes, edges, past } = get();
    if (future.length === 0) return;
    const next = future[0]!;
    const newFuture = future.slice(1);
    const newPast = pushHistory(past, { nodes: [...nodes], edges: [...edges] });
    set({
      nodes: next.nodes,
      edges: next.edges,
      past: newPast,
      future: newFuture,
      isDirty: true,
      canUndo: true,
      canRedo: newFuture.length > 0,
    });
  },

  markSaved: () => set({ isDirty: false, lastSaved: new Date() }),
  markDirty: () => set({ isDirty: true }),

  updateNodeTelemetry: (nodeId, status, msgPerSec, value) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                ...(status ? { status } : {}),
                ...(typeof msgPerSec === 'number' ? { msgPerSec } : {}),
              } as NodeData,
            }
          : n,
      ),
      nodeDevices: (() => {
        if (!value) return state.nodeDevices;
        const existing = state.nodeDevices.get(nodeId);
        if (!existing) return state.nodeDevices;
        const nowTs = value.ts;
        const nextTelemetry = [...(existing.telemetry ?? []), value]
          .filter((entry) => nowTs - entry.ts <= 30_000)
          .slice(-60);
        const next = new Map(state.nodeDevices);
        next.set(nodeId, { ...existing, telemetry: nextTelemetry });
        return next;
      })(),
    }));
  },

  updateNodeLastMessage: (nodeId, msg) => {
    set((state) => ({
      nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, data: ({ ...n.data, lastMessage: msg } as unknown as NodeData) } : n)),
    }));
  },

  setSseStatus: (sseStatus) => set({ sseStatus }),

  loadConfig: (nodes, edges) => {
    const hydratedNodes = nodes.map((node) => {
      const deviceTypeId = (node.data as { deviceTypeId?: string } | undefined)?.deviceTypeId;
      if (!deviceTypeId || !getDeviceType(deviceTypeId)) {
        return {
          ...node,
          type: 'orphan',
          data: { ...node.data, __orphan: true },
        };
      }

      return node;
    });
    // Preserve `lastSaved` if it already exists — loadConfig may be called after a
    // successful save (e.g. on remount with cached query data) and resetting it to
    // null would lie to the user about save state.
    const prevLastSaved = get().lastSaved;
    set({
      nodes: hydratedNodes,
      edges,
      past: [],
      future: [],
      isDirty: false,
      lastSaved: prevLastSaved,
      canUndo: false,
      canRedo: false,
    });
  },

  setNodeDevice: (canvasNodeId, device) => {
    set((state) => {
      const next = new Map(state.nodeDevices);
      next.set(canvasNodeId, { ...device, telemetry: device.telemetry ?? [] });
      return { nodeDevices: next };
    });
  },

  removeNodeDevice: (canvasNodeId) => {
    set((state) => {
      const next = new Map(state.nodeDevices);
      next.delete(canvasNodeId);
      return { nodeDevices: next };
    });
  },

  bulkSetNodeDevices: (devices) => {
    const next = new Map<string, DeviceRow>();
    for (const row of devices) {
      next.set(row.canvasNodeId, { ...row.device, telemetry: row.device.telemetry ?? [] });
    }
    set({ nodeDevices: next });
  },

  getDeviceByCanvasNodeId: (canvasNodeId) => get().nodeDevices.get(canvasNodeId),

  getDevicesBySimulationDesired: () => {
    const values = Array.from(get().nodeDevices.values());
    if (values.length === 0) {
      return { allDesired: false, allNotDesired: false, mixed: false };
    }
    const allDesired = values.every((device) => device.simulationDesired);
    const allNotDesired = values.every((device) => !device.simulationDesired);
    return {
      allDesired,
      allNotDesired,
      mixed: !allDesired && !allNotDesired,
    };
  },
}));

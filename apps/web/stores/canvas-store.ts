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
import type { NodeData } from '@controlai-web/shared-types';

const MAX_HISTORY = 50;

interface HistoryEntry {
  nodes: Node<NodeData>[];
  edges: Edge[];
}

interface CanvasState {
  nodes: Node<NodeData>[];
  edges: Edge[];
  past: HistoryEntry[];
  future: HistoryEntry[];
  isDirty: boolean;
  lastSaved: Date | null;
  sseStatus: 'disconnected' | 'connecting' | 'connected' | 'error';

  // Graph mutations (push to history)
  setNodes: (nodes: Node<NodeData>[]) => void;
  setEdges: (edges: Edge[]) => void;
  onNodesChange: (changes: NodeChange<Node<NodeData>>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (node: Node<NodeData>) => void;
  updateNodeData: (nodeId: string, data: Partial<NodeData>) => void;

  // Undo/redo
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  // Persistence state
  markSaved: () => void;
  markDirty: () => void;

  // Telemetry overlays — throttled, no history
  updateNodeTelemetry: (nodeId: string, status: string, msgPerSec: number) => void;

  // SSE status
  setSseStatus: (status: 'disconnected' | 'connecting' | 'connected' | 'error') => void;

  // Load from server
  loadConfig: (nodes: Node<NodeData>[], edges: Edge[]) => void;
}

function snapshot(state: { nodes: Node<NodeData>[]; edges: Edge[] }): HistoryEntry {
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

  addNode: (node) => {
    const state = get();
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
      n.id === nodeId ? { ...n, data: { ...n.data, ...data } as NodeData } : n,
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

  updateNodeTelemetry: (nodeId, status, msgPerSec) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, status, msgPerSec } as NodeData }
          : n,
      ),
    }));
  },

  setSseStatus: (sseStatus) => set({ sseStatus }),

  loadConfig: (nodes, edges) => {
    set({
      nodes,
      edges,
      past: [],
      future: [],
      isDirty: false,
      lastSaved: null,
      canUndo: false,
      canRedo: false,
    });
  },
}));

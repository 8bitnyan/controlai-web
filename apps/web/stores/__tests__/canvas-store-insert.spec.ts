import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasStore } from '../canvas-store';

describe('canvas-store insertAutoCreatedNode', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      nodes: [
        {
          id: 'gateway-1',
          type: 'broker',
          position: { x: 100, y: 200 },
          data: { deviceTypeId: 'core-generic-broker', label: 'Gateway' },
        },
      ],
      edges: [],
      past: [],
      future: [],
      isDirty: false,
      canUndo: false,
      canRedo: false,
    });

    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('child-1')
      .mockReturnValueOnce('child-2')
      .mockReturnValueOnce('child-3');
  });

  it('inserts 3 auto-created nodes with deterministic offsets and edges', () => {
    const gatewayPosition = { x: 100, y: 200 };
    const store = useCanvasStore.getState();

    const ids = [
      store.insertAutoCreatedNode(
        { deviceTypeId: 'core-generic-sensor', parentNodeId: 'gateway-1', label: 'S1' },
        gatewayPosition,
        0,
      ),
      store.insertAutoCreatedNode(
        { deviceTypeId: 'core-generic-sensor', parentNodeId: 'gateway-1', label: 'S2' },
        gatewayPosition,
        1,
      ),
      store.insertAutoCreatedNode(
        { deviceTypeId: 'core-generic-sensor', parentNodeId: 'gateway-1', label: 'S3' },
        gatewayPosition,
        2,
      ),
    ];

    expect(ids).toEqual(['child-1', 'child-2', 'child-3']);

    const state = useCanvasStore.getState();
    expect(state.nodes).toHaveLength(4);
    expect(state.edges).toHaveLength(3);

    expect(state.nodes[1]?.position).toEqual({ x: 300, y: 300 });
    expect(state.nodes[2]?.position).toEqual({ x: 340, y: 340 });
    expect(state.nodes[3]?.position).toEqual({ x: 380, y: 380 });

    expect(state.edges.map((edge) => ({ source: edge.source, target: edge.target }))).toEqual([
      { source: 'gateway-1', target: 'child-1' },
      { source: 'gateway-1', target: 'child-2' },
      { source: 'gateway-1', target: 'child-3' },
    ]);
    expect(state.isDirty).toBe(true);
    expect(state.past.length).toBe(3);
  });
});

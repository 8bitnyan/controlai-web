import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import DeviceNode from '../nodes/device-node';

const getDeviceByCanvasNodeId = vi.fn();

vi.mock('@controlai-web/shared-types', () => ({
  getDeviceType: () => ({ visual: { iconRef: 'Box', accentColor: '#000' }, category: 'sensor', displayName: 'Sensor' }),
}));
vi.mock('../canvas-context', () => ({ useCanvasContext: () => ({ orgId: 'o1', siteGroupId: 's1' }) }));
vi.mock('@/lib/trpc/client', () => ({ trpc: { site: { list: { useQuery: () => ({ data: [] }) } } } }));
vi.mock('@/stores/canvas-store', () => ({ useCanvasStore: (sel: any) => sel({ getDeviceByCanvasNodeId }) }));
vi.mock('../nodes/node-config-dialog', () => ({ NodeConfigDialog: () => null }));
vi.mock('../nodes/status-dot', () => ({ StatusDot: () => null }));
vi.mock('../nodes/node-sparkline', () => ({ NodeSparkline: () => null }));
vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
}));

describe('DeviceNode', () => {
  it('shows dashed border + ghost icon when UNREGISTERED', () => {
    getDeviceByCanvasNodeId.mockReturnValue({ registrationState: 'UNREGISTERED', deviceKey: 'dev1' });
    const { container } = render(<DeviceNode id="n1" selected={false} data={{ label: 'n' } as any} dragging={false} type="sensor" zIndex={1} isConnectable draggable selectable deletable positionAbsoluteX={0} positionAbsoluteY={0} />);
    expect(container.querySelector('.border-dashed')).toBeTruthy();
    expect(container.querySelector('.opacity-40')).toBeTruthy();
  });

  it('shows solid border when REGISTERED', () => {
    getDeviceByCanvasNodeId.mockReturnValue({ registrationState: 'REGISTERED', deviceKey: 'dev1', realUuid: 'uuid' });
    const { container } = render(<DeviceNode id="n1" selected={false} data={{ label: 'n' } as any} dragging={false} type="sensor" zIndex={1} isConnectable draggable selectable deletable positionAbsoluteX={0} positionAbsoluteY={0} />);
    expect(container.querySelector('.border-solid')).toBeTruthy();
    expect(screen.getByText('uuid')).toBeInTheDocument();
  });
});

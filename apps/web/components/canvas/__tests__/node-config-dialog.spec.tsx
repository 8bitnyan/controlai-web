import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { NodeConfigDialog } from '../nodes/node-config-dialog';

const state = { device: { registrationState: 'UNREGISTERED', deviceKey: 'dev-1', simulationDesired: true } };
const mutate = vi.fn();

vi.mock('../canvas-context', () => ({ useCanvasContext: () => ({ orgId: 'o1', siteGroupId: 's1' }) }));
vi.mock('@/stores/canvas-store', () => ({ useCanvasStore: (sel: any) => sel({ updateNodeData: vi.fn(), getDeviceByCanvasNodeId: () => state.device }) }));
vi.mock('@/lib/trpc/client', () => ({ trpc: { device: { update: { useMutation: () => ({ mutate, isPending: false }) } }, gateway: { list: { useQuery: () => ({ data: [] }) } } } }));

describe('NodeConfigDialog synthetic config', () => {
  it('shows synthetic fields only when UNREGISTERED', () => {
    render(<NodeConfigDialog open onClose={() => {}} nodeId="n1" nodeType="sensor" data={{ label: 'S', device_id: 'd', topic_prefix: 't', qos: '0' } as any} />);
    expect(screen.getByText('Synthetic Signal Config')).toBeInTheDocument();
  });

  it('validates valueMin < valueMax', () => {
    render(<NodeConfigDialog open onClose={() => {}} nodeId="n1" nodeType="sensor" data={{ label: 'S', device_id: 'd', topic_prefix: 't', qos: '0' } as any} />);
    fireEvent.change(screen.getByLabelText('valueMin'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('valueMax'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('valueMin must be less than valueMax')).toBeInTheDocument();
  });

  it('shows brokerKind only for broker and retentionDays only for timescaledb', () => {
    const { rerender } = render(<NodeConfigDialog open onClose={() => {}} nodeId="n1" nodeType="broker" data={{ label: 'B', kind: 'mosquitto', throughput: 'low' } as any} />);
    expect(screen.getByLabelText('Synthetic Signal Config brokerKind')).toBeInTheDocument();
    rerender(<NodeConfigDialog open onClose={() => {}} nodeId="n1" nodeType="timescaledb" data={{ label: 'T', retention: '7d' } as any} />);
    expect(screen.getByLabelText('Max storage (GB)')).toBeInTheDocument();
  });
});

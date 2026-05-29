import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import OrphanNode from '../nodes/orphan-node';
import { MigrateDeviceTypeDialog } from '../nodes/migrate-device-type-dialog';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@xyflow/react', async () => {
  const mod = await vi.importActual('@xyflow/react');
  return { ...mod, Handle: () => null };
});
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
}));

const replaceDeviceType = vi.fn();
const setNodes = vi.fn();
vi.mock('@/stores/canvas-store', () => ({
  useCanvasStore: {
    getState: () => ({
      nodes: [{ id: 'n1' }],
      setNodes,
      replaceDeviceType,
    }),
  },
}));

describe('OrphanNode + migrate dialog', () => {
  it('renders unknown device type badge and menu actions', async () => {
    render(<OrphanNode id="n1" data={{ deviceTypeId: 'orphan-xyz' }} dragging={false} selected={false} draggable selectable deletable zIndex={0} isConnectable positionAbsoluteX={0} positionAbsoluteY={0} type="orphan" /> as any);
    expect(screen.getByText(/Unknown device type: orphan-xyz/i)).toBeInTheDocument();
    expect(await screen.findByText(/Migrate/i)).toBeInTheDocument();
    expect(screen.getByText(/Delete/i)).toBeInTheDocument();
  });

  it('selecting a manifest calls store.replaceDeviceType', async () => {
    render(<MigrateDeviceTypeDialog open onClose={() => {}} nodeId="n1" />);
    fireEvent.click(await screen.findByRole('button', { name: /core-generic-sensor(?!-)/i }));
    await waitFor(() => {
      expect(replaceDeviceType).toHaveBeenCalledWith('n1', 'core-generic-sensor');
    });
  });
});

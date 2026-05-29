import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NodePalette } from '../node-palette';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../canvas-context', () => ({ useCanvasContext: () => ({ orgId: 'org-1' }) }));

describe('NodePalette', () => {
  it('renders 6 category tabs and sensor active by default', () => {
    render(<NodePalette />);
    expect(screen.getByRole('button', { name: 'sensor' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'gateway' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'broker' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ingest' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'tsdb' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'monitoring' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Drag to add Generic Sensor node/i)).toBeInTheDocument();
  });

  it('filters by search text for daejak manifests', () => {
    render(<NodePalette />);
    fireEvent.change(screen.getByPlaceholderText(/Search device types/i), { target: { value: 'daejak' } });
    expect(screen.getByLabelText(/Daejak Main/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Daejak VM/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Generic Sensor/i)).not.toBeInTheDocument();
  });

  it('writes recent key to localStorage on drag start', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    render(<NodePalette />);
    const sensor = screen.getByLabelText(/Generic Sensor/i);
    fireEvent.dragStart(sensor, {
      dataTransfer: { setData: vi.fn(), effectAllowed: 'move' },
    });
    expect(setItem).toHaveBeenCalledWith('controlai:palette:recent:org-1', expect.any(String));
  });
});

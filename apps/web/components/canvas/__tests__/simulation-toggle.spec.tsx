import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SimulationToggle } from '../simulation-toggle';

const { toastSuccess, toastError, mutate, state } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  mutate: vi.fn(),
  state: {
  allDesired: false,
  allNotDesired: false,
  mixed: false,
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
  },
}));

vi.mock('@/stores/canvas-store', () => ({
  useCanvasStore: {
    getState: () => ({
      getDevicesBySimulationDesired: () => state,
    }),
  },
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    device: {
      setSiteGroupSimulation: {
        useMutation: (opts?: { onSuccess?: () => void; onError?: () => void }) => ({
          mutate: (input: { orgId: string; siteGroupId: string; desired: boolean }) => {
            mutate(input);
            opts?.onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
  },
}));

describe('SimulationToggle', () => {
  beforeEach(() => {
    state.allDesired = false;
    state.allNotDesired = false;
    state.mixed = false;
    mutate.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it('renders Play icon when allNotDesired', () => {
    state.allNotDesired = true;
    render(<SimulationToggle orgId="org-1" siteGroupId="sg-1" />);
    expect(screen.getByTestId('simulation-icon-play')).toBeInTheDocument();
  });

  it('renders Pause icon when allDesired', () => {
    state.allDesired = true;
    render(<SimulationToggle orgId="org-1" siteGroupId="sg-1" />);
    expect(screen.getByTestId('simulation-icon-pause')).toBeInTheDocument();
  });

  it('renders amber dot when mixed', () => {
    state.mixed = true;
    render(<SimulationToggle orgId="org-1" siteGroupId="sg-1" />);
    expect(screen.getByTestId('simulation-mixed-dot')).toBeInTheDocument();
  });

  it('click triggers mutation with desired opposite current', () => {
    state.allDesired = true;
    render(<SimulationToggle orgId="org-1" siteGroupId="sg-1" />);
    fireEvent.click(screen.getByTestId('simulation-toggle'));
    expect(mutate).toHaveBeenCalledWith({ orgId: 'org-1', siteGroupId: 'sg-1', desired: false });
  });
});

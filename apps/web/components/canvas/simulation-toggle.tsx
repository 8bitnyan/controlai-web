'use client';

import React from 'react';
import { Pause, Play } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc/client';
import { useCanvasStore } from '@/stores/canvas-store';

type SimulationAggregate = {
  allDesired: boolean;
  allNotDesired: boolean;
  mixed: boolean;
};

const FALLBACK_AGGREGATE: SimulationAggregate = {
  allDesired: false,
  allNotDesired: false,
  mixed: false,
};

export function SimulationToggle({ orgId, siteGroupId }: { orgId: string; siteGroupId: string }) {
  const getAggregate = useCanvasStore.getState() as {
    getDevicesBySimulationDesired?: () => SimulationAggregate;
  };
  const aggregate = getAggregate.getDevicesBySimulationDesired?.() ?? FALLBACK_AGGREGATE;

  const desired = aggregate.allNotDesired;
  const isPause = aggregate.allDesired;
  const label = desired ? 'Enable simulation' : 'Disable simulation';

  const mutation = trpc.device.setSiteGroupSimulation.useMutation({
    onSuccess: () => {
      toast.success(`Simulation: ${desired ? 'enabled' : 'disabled'}`);
    },
    onError: () => {
      toast.error('Failed to update simulation state');
    },
  });

  return (
    <Button
      variant="ghost"
      size="sm"
      title={label}
      aria-label={label}
      disabled={mutation.isPending}
      onClick={() => mutation.mutate({ orgId, siteGroupId, desired })}
      className="relative"
      data-testid="simulation-toggle"
    >
      {isPause ? <Pause data-testid="simulation-icon-pause" className="h-4 w-4" /> : <Play data-testid="simulation-icon-play" className="h-4 w-4" />}
      {aggregate.mixed ? <span data-testid="simulation-mixed-dot" className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-500" /> : null}
    </Button>
  );
}

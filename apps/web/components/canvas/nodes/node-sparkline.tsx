'use client';

import React from 'react';

import { useMemo } from 'react';
import { useCanvasStore, type SignalValue } from '@/stores/canvas-store';

const EMPTY_TELEMETRY: SignalValue[] = [];

export function NodeSparkline({ canvasNodeId }: { canvasNodeId: string }) {
  // IMPORTANT: do NOT inline `?? []` in the selector — Zustand caches the snapshot
  // by reference, and a new array each render triggers an infinite loop.
  const telemetry =
    useCanvasStore((s) => s.nodeDevices.get(canvasNodeId)?.telemetry) ?? EMPTY_TELEMETRY;

  const path = useMemo(() => {
    if (telemetry.length < 2) return null;
    const values = telemetry.map((d) => d.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    return telemetry
      .map((point, i) => {
        const x = (i / Math.max(telemetry.length - 1, 1)) * 120;
        const y = 24 - ((point.value - min) / range) * 24;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [telemetry]);

  if (!path) {
    return <div className="text-[10px] text-muted-foreground">No signal yet</div>;
  }

  return (
    <svg viewBox="0 0 120 24" className="h-6 w-full">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground" />
    </svg>
  );
}

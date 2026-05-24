'use client';

import { useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import type { MonitoringData } from '@controlai-web/shared-types';
import { StatusDot } from './status-dot';
import { NodeConfigDialog } from './node-config-dialog';

export function MonitoringNode({ id, data: rawData, selected }: NodeProps) {
  const data = rawData as unknown as MonitoringData;
  const [configOpen, setConfigOpen] = useState(false);

  return (
    <>
      <div
        className={cn(
          'relative min-w-[140px] rounded-lg border-2 bg-white px-3 py-2 shadow-sm cursor-default',
          'border-rose-400',
          selected && 'ring-2 ring-rose-500 ring-offset-1',
        )}
        onDoubleClick={() => setConfigOpen(true)}
        role="button"
        tabIndex={0}
        aria-label={`Monitoring node: ${data.label}`}
        onKeyDown={(e) => e.key === 'Enter' && setConfigOpen(true)}
      >
        <StatusDot status={data.status} msgPerSec={data.msgPerSec} />
        <Handle
          type="target"
          position={Position.Left}
          id="ingress"
          className="!bg-rose-500 !w-3 !h-3 !border-2 !border-white"
        />
        <div className="flex items-center gap-2">
          <span className="text-lg" aria-hidden>📊</span>
          <div>
            <div className="text-xs font-semibold text-rose-700">Monitoring</div>
            <div className="text-xs text-muted-foreground truncate max-w-[100px]">
              {data.label}
            </div>
          </div>
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {data.metrics.map((m) => (
            <span key={m} className="rounded bg-rose-50 px-1.5 py-0.5 text-[9px] font-medium text-rose-600">
              {m.replace('_', ' ')}
            </span>
          ))}
        </div>
      </div>
      <NodeConfigDialog
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        nodeId={id}
        nodeType="monitoring"
        data={data}
      />
    </>
  );
}

'use client';

import { useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import type { TimescaleDBData } from '@controlai-web/shared-types';
import { StatusDot } from './status-dot';
import { NodeConfigDialog } from './node-config-dialog';

export function TimescaleDBNode({ id, data: rawData, selected }: NodeProps) {
  const data = rawData as unknown as TimescaleDBData;
  const [configOpen, setConfigOpen] = useState(false);

  return (
    <>
      <div
        className={cn(
          'relative min-w-[140px] rounded-lg border-2 bg-white px-3 py-2 shadow-sm cursor-default',
          'border-indigo-400',
          selected && 'ring-2 ring-indigo-500 ring-offset-1',
        )}
        onDoubleClick={() => setConfigOpen(true)}
        role="button"
        tabIndex={0}
        aria-label={`TimescaleDB node: ${data.label}`}
        onKeyDown={(e) => e.key === 'Enter' && setConfigOpen(true)}
      >
        <StatusDot status={data.status} msgPerSec={data.msgPerSec} />
        <Handle
          type="target"
          position={Position.Left}
          id="tsdb"
          className="!bg-indigo-500 !w-3 !h-3 !border-2 !border-white"
        />
        <div className="flex items-center gap-2">
          <span className="text-lg" aria-hidden>🗄️</span>
          <div>
            <div className="text-xs font-semibold text-indigo-700">TimescaleDB</div>
            <div className="text-xs text-muted-foreground truncate max-w-[100px]">
              {data.label}
            </div>
          </div>
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">
          Retention: {data.retention}
        </div>
      </div>
      <NodeConfigDialog
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        nodeId={id}
        nodeType="timescaledb"
        data={data}
      />
    </>
  );
}

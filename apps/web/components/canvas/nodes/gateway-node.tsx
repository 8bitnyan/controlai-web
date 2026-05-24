'use client';

import { useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import type { GatewayData } from '@controlai-web/shared-types';
import { StatusDot } from './status-dot';
import { NodeConfigDialog } from './node-config-dialog';

export function GatewayNode({ id, data: rawData, selected }: NodeProps) {
  const data = rawData as unknown as GatewayData;
  const [configOpen, setConfigOpen] = useState(false);

  return (
    <>
      <div
        className={cn(
          'relative min-w-[140px] rounded-lg border-2 bg-white px-3 py-2 shadow-sm cursor-default',
          'border-violet-400',
          selected && 'ring-2 ring-violet-500 ring-offset-1',
        )}
        onDoubleClick={() => setConfigOpen(true)}
        role="button"
        tabIndex={0}
        aria-label={`Gateway node: ${data.label}`}
        onKeyDown={(e) => e.key === 'Enter' && setConfigOpen(true)}
      >
        <StatusDot status={data.status} msgPerSec={data.msgPerSec} />
        <Handle
          type="target"
          position={Position.Left}
          id="data"
          className="!bg-violet-500 !w-3 !h-3 !border-2 !border-white"
        />
        <div className="flex items-center gap-2">
          <span className="text-lg" aria-hidden>🔀</span>
          <div>
            <div className="text-xs font-semibold text-violet-700">Gateway</div>
            <div className="text-xs text-muted-foreground truncate max-w-[100px]">
              {data.label}
            </div>
          </div>
        </div>
        {data.gateway_id && (
          <div className="mt-1 text-[10px] text-muted-foreground truncate">
            {data.gateway_id}
          </div>
        )}
        <div className="mt-1 text-[10px] text-muted-foreground uppercase">
          {data.protocol}
        </div>
        <Handle
          type="source"
          position={Position.Right}
          id="mqtt"
          className="!bg-violet-500 !w-3 !h-3 !border-2 !border-white"
        />
      </div>
      <NodeConfigDialog
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        nodeId={id}
        nodeType="gateway"
        data={data}
      />
    </>
  );
}

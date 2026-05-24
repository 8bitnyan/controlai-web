'use client';

import { useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import type { SensorData } from '@controlai-web/shared-types';
import { StatusDot } from './status-dot';
import { NodeConfigDialog } from './node-config-dialog';

export function SensorNode({ id, data: rawData, selected }: NodeProps) {
  const data = rawData as unknown as SensorData;
  const [configOpen, setConfigOpen] = useState(false);

  return (
    <>
      <div
        className={cn(
          'relative min-w-[140px] rounded-lg border-2 bg-white px-3 py-2 shadow-sm cursor-default',
          'border-sky-400',
          selected && 'ring-2 ring-sky-500 ring-offset-1',
        )}
        onDoubleClick={() => setConfigOpen(true)}
        role="button"
        tabIndex={0}
        aria-label={`Sensor node: ${data.label}`}
        onKeyDown={(e) => e.key === 'Enter' && setConfigOpen(true)}
      >
        <StatusDot status={data.status} msgPerSec={data.msgPerSec} />
        <div className="flex items-center gap-2">
          <span className="text-lg" aria-hidden>📡</span>
          <div>
            <div className="text-xs font-semibold text-sky-700">Sensor</div>
            <div className="text-xs text-muted-foreground truncate max-w-[100px]">
              {data.label}
            </div>
          </div>
        </div>
        {data.device_id && (
          <div className="mt-1 text-[10px] text-muted-foreground truncate">
            {data.device_id}
          </div>
        )}
        <div className="mt-1 text-[10px] text-muted-foreground">
          {data.topic_prefix} · QoS {data.qos}
        </div>
        <Handle
          type="source"
          position={Position.Right}
          id="data"
          className="!bg-sky-500 !w-3 !h-3 !border-2 !border-white"
        />
      </div>
      <NodeConfigDialog
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        nodeId={id}
        nodeType="sensor"
        data={data}
      />
    </>
  );
}

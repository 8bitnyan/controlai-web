'use client';

import { useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import * as Icons from 'lucide-react';
import { cn } from '@/lib/utils';
import { getDeviceType, type BrokerData, type NodeData, type NodeType } from '@controlai-web/shared-types';
import { StatusDot } from './status-dot';
import { NodeConfigDialog } from './node-config-dialog';
import { useCanvasContext } from '../canvas-context';
import { trpc } from '@/lib/trpc/client';
import { Badge } from '@/components/ui/badge';
import { useCanvasStore } from '@/stores/canvas-store';

export default function DeviceNode({ id, data: rawData, selected }: NodeProps) {
  const data = rawData as NodeData & { deviceTypeId?: string; applyError?: boolean; onShowSiteDetail?: (siteId: string) => void };
  const manifest = getDeviceType(data.deviceTypeId ?? '') ?? getDeviceType('core-generic-sensor')!;
  const Icon = (Icons[manifest.visual.iconRef as keyof typeof Icons] ?? Icons.Box) as React.ComponentType<{ className?: string }>;
  const [configOpen, setConfigOpen] = useState(false);
  const { orgId, siteGroupId } = useCanvasContext();
  const device = useCanvasStore((state) => state.getDeviceByCanvasNodeId(id));
  const isBroker = manifest.category === 'broker';
  const { data: sites = [] } = trpc.site.list.useQuery({ orgId, siteGroupId }, { enabled: isBroker });
  const boundSite = isBroker ? sites.find((s) => s.canvasNodeId === id) : null;
  const nodeType = (manifest.category === 'tsdb' ? 'timescaledb' : manifest.category) as NodeType;
  const identity = !device
    ? null
    : device.registrationState === 'REGISTERED'
      ? device.realUuid?.slice(0, 12) ?? device.deviceKey.slice(0, 8)
      : device.deviceKey.slice(0, 8);

  return (
    <>
      <div className={cn('relative min-w-[140px] rounded-lg border-2 bg-white px-3 py-2 shadow-sm cursor-default', selected && 'ring-2 ring-offset-1')} style={{ borderColor: manifest.visual.accentColor }} onDoubleClick={() => setConfigOpen(true)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setConfigOpen(true)}>
        <StatusDot status={data.status} msgPerSec={data.msgPerSec} />
        {(manifest.category === 'gateway' || manifest.category === 'broker' || manifest.category === 'ingest' || manifest.category === 'tsdb' || manifest.category === 'monitoring') && <Handle type="target" position={Position.Left} />}
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4" />
          <div>
            <div className="text-xs font-semibold">{manifest.displayName}</div>
            <div className="text-xs text-muted-foreground truncate max-w-[100px]">{data.label}</div>
            {device && (
              <>
                {device.registrationState === 'UNREGISTERED' && (
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-pulse" />
                    <span>Unregistered</span>
                  </div>
                )}
                {device.registrationState === 'REGISTERING' && (
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-amber-600">
                    <Icons.Loader2 className="h-3 w-3 animate-spin" />
                    <span>Registering…</span>
                  </div>
                )}
                {device.registrationState === 'ORPHANED' && (
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-red-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                    <span>Orphaned</span>
                  </div>
                )}
                {identity && <div className="mt-0.5 text-[10px] font-mono text-muted-foreground">{identity}</div>}
              </>
            )}
          </div>
        </div>
        {isBroker && boundSite && (
          <div className="mt-2 border-t border-border/50 pt-2">
            <div className="space-y-1">
              <div className="flex items-center justify-between"><Badge className="text-[9px] bg-green-100 text-green-700 hover:bg-green-100">Provisioned</Badge><button type="button" className="text-[9px] text-blue-600 hover:underline" onClick={() => data.onShowSiteDetail?.(boundSite.id)}>Details</button></div>
            </div>
          </div>
        )}
        {(manifest.category === 'sensor' || manifest.category === 'gateway' || manifest.category === 'broker') && <Handle type="source" position={Position.Right} />}
      </div>
      <NodeConfigDialog open={configOpen} onClose={() => setConfigOpen(false)} nodeId={id} nodeType={nodeType} data={data as NodeData} />
    </>
  );
}

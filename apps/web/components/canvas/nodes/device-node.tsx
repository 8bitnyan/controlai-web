'use client';

import { useState } from 'react';
import React from 'react';
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
import { NodeSparkline } from './node-sparkline';
import { Button } from '@/components/ui/button';
import { ConnectSerialDialog } from '@/components/devices/connect-serial-dialog';

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

  const isUnregistered = device?.registrationState === 'UNREGISTERED';
  const isRegistered = device?.registrationState === 'REGISTERED';
  const [serialOpen, setSerialOpen] = useState(false);
  const isGateway = manifest.category === 'gateway';
  const gatewayByCanvas = trpc.gateway.byCanvasNode.useQuery({ orgId, siteGroupId, canvasNodeId: id }, { enabled: isGateway });
  const lastMessage = (data as NodeData & { lastMessage?: { topic: string; summary: string; ts: number; source: 'sim' | 'board' } }).lastMessage;

  return (
    <>
      <div className={cn('relative min-w-[140px] rounded-lg border-2 bg-white px-3 py-2 shadow-sm cursor-default', isUnregistered && 'border-dashed', isRegistered && 'border-solid', selected && 'ring-2 ring-offset-1')} style={{ borderColor: manifest.visual.accentColor }} onDoubleClick={() => setConfigOpen(true)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setConfigOpen(true)}>
        <StatusDot status={data.status} msgPerSec={data.msgPerSec} />
        {(() => {
          const isTargetCategory = manifest.category === 'gateway' || manifest.category === 'broker' || manifest.category === 'ingest' || manifest.category === 'tsdb' || manifest.category === 'monitoring';
          if (!isTargetCategory) return null;
          // Gateway-class nodes: data ENTERS from the left → target handles on LEFT, one per port.
          // Skip 'upstream' (that port — if declared — is rendered as the outgoing source on the right below).
          const allPorts = manifest.ports ?? [];
          const inPorts = allPorts.filter((p) => p.id !== 'upstream');
          const handles = inPorts.length > 0 ? inPorts : [{ id: 'default-in' }];
          return handles.map((p, i) => {
            const topPct = handles.length === 1 ? 50 : ((i + 1) / (handles.length + 1)) * 100;
            const protoTag = ('acceptsProtocols' in p && Array.isArray(p.acceptsProtocols) ? p.acceptsProtocols[0] : '') as string;
            const color = protoTag.startsWith('analog') ? '#f59e0b' : protoTag.startsWith('mqtt') ? '#8b5cf6' : '#0ea5e9';
            return (
              <React.Fragment key={`tgt-${p.id}`}>
                <Handle id={p.id} type="target" position={Position.Left} style={{ top: `${topPct}%`, background: color, width: 10, height: 10 }} title={`${p.id} (${protoTag})`} />
                <span className="absolute text-[9px] text-muted-foreground" style={{ top: `calc(${topPct}% - 6px)`, left: 8 }}>{p.id.replace(/^child-/, '')}</span>
              </React.Fragment>
            );
          });
        })()}
        <div className="flex items-center justify-between gap-2">
          {isGateway ? <Button size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); setSerialOpen(true); }}><Icons.Usb className="h-3.5 w-3.5" /></Button> : <span />}
        </div>
        <div className="flex items-center gap-2">
          <Icon className={cn('h-4 w-4', isUnregistered && 'opacity-40')} />
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
            {lastMessage ? <div className="mt-1 text-[10px] text-muted-foreground" title={`${lastMessage.summary} (${lastMessage.topic})`}>last: {Math.max(0, Math.round((Date.now() - lastMessage.ts) / 1000))}s ago · {lastMessage.source}</div> : null}
          </div>
        </div>
        {isBroker && boundSite && (
          <div className="mt-2 border-t border-border/50 pt-2">
            <div className="space-y-1">
              <div className="flex items-center justify-between"><Badge className="text-[9px] bg-green-100 text-green-700 hover:bg-green-100">Provisioned</Badge><button type="button" className="text-[9px] text-blue-600 hover:underline" onClick={() => data.onShowSiteDetail?.(boundSite.id)}>Details</button></div>
            </div>
          </div>
        )}
        {(() => {
          const isSourceCategory = manifest.category === 'sensor' || manifest.category === 'gateway' || manifest.category === 'broker' || manifest.category === 'ingest' || manifest.category === 'tsdb';
          if (!isSourceCategory) return null;
          // Data exits the node to the RIGHT via a single source handle ('upstream' port if declared, otherwise default).
          const outPorts = (manifest.ports ?? []).filter((p) => p.direction === 'out');
          const upstream = outPorts.find((p) => p.id === 'upstream');
          const sourceHandleId = upstream?.id ?? 'default-out';
          // Child/input slots (everything that is NOT 'upstream') render as target handles on the LEFT so children can wire INTO this node.
          const childPorts = outPorts.filter((p) => p.id !== 'upstream');
          const upstreamColor = upstream?.acceptsProtocols?.[0]?.startsWith('analog') ? '#f59e0b' : '#0ea5e9';
          return (
            <>
              <Handle key={`src-${sourceHandleId}`} id={sourceHandleId} type="source" position={Position.Right} style={{ top: '50%', background: upstreamColor, width: 10, height: 10 }} title={`${sourceHandleId} (${upstream?.acceptsProtocols?.[0] ?? 'out'})`} />
              <span className="absolute text-[9px] text-muted-foreground" style={{ top: 'calc(50% - 6px)', right: 8 }}>→</span>
              {childPorts.map((p, i) => {
                const topPct = childPorts.length === 1 ? 50 : ((i + 1) / (childPorts.length + 1)) * 100;
                const protoTag = p.acceptsProtocols?.[0] ?? '';
                const color = protoTag.startsWith('analog') ? '#f59e0b' : '#0ea5e9';
                const label = p.id === 'noise-input' ? 'noise' : p.id.replace(/^child-/, '');
                return (
                  <React.Fragment key={`tgt-child-${p.id}`}>
                    <Handle id={p.id} type="target" position={Position.Left} style={{ top: `${topPct}%`, background: color, width: 10, height: 10 }} title={`${p.id} (${protoTag})`} />
                    <span className="absolute text-[9px]" style={{ top: `calc(${topPct}% - 6px)`, left: 8, color }}>{label}</span>
                  </React.Fragment>
                );
              })}
            </>
          );
        })()}
        <div className="mt-2 border-t border-border/50 pt-2">
          <NodeSparkline canvasNodeId={id} />
        </div>
      </div>
      <NodeConfigDialog open={configOpen} onClose={() => setConfigOpen(false)} nodeId={id} nodeType={nodeType} data={data as NodeData} />
      {gatewayByCanvas.data ? <ConnectSerialDialog open={serialOpen} onOpenChange={setSerialOpen} orgId={orgId} gatewayId={gatewayByCanvas.data.id} isSimulator={gatewayByCanvas.data.kind === 'simulator'} /> : null}
    </>
  );
}

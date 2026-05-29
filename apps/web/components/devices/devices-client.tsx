'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { getDeviceType, listDeviceTypes } from '@controlai-web/shared-types';
import { trpc } from '@/lib/trpc/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConnectSerialDialog } from './connect-serial-dialog';
import { LiveBrokerLog } from './live-broker-log';

const REG_STATES = ['all', 'UNREGISTERED', 'REGISTERING', 'REGISTERED', 'ORPHANED'] as const;

type RegistrationState = Exclude<(typeof REG_STATES)[number], 'all'>;

function truncate(value: string | null | undefined, size: number) {
  if (!value) return '—';
  return value.length > size ? `${value.slice(0, size)}…` : value;
}

function relativeTime(value: Date | string | null | undefined) {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  const diffSec = Math.round((date.getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  return rtf.format(Math.round(diffSec / 86400), 'day');
}

function RegistrationBadge({ state }: { state: RegistrationState }) {
  if (state === 'REGISTERED') return null;
  if (state === 'UNREGISTERED') return <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-pulse" />Unregistered</span>;
  if (state === 'REGISTERING') return <span className="inline-flex items-center gap-1 text-[10px] text-amber-600">Registering…</span>;
  return <span className="inline-flex items-center gap-1 text-[10px] text-red-600"><span className="h-1.5 w-1.5 rounded-full bg-red-500" />Orphaned</span>;
}

export function DevicesClient({ orgId, projectId, siteGroupId }: { orgId: string; projectId: string; siteGroupId: string }) {
  const utils = trpc.useUtils();
  const [registrationState, setRegistrationState] = useState<(typeof REG_STATES)[number]>('all');
  const [deviceTypeId, setDeviceTypeId] = useState<string>('all');
  const [parentDeviceKey, setParentDeviceKey] = useState('');
  const [serialGatewayId, setSerialGatewayId] = useState<string | null>(null);
  const gatewayList = trpc.gateway.list.useQuery({ orgId, siteGroupId });

  const listInput = {
    orgId,
    siteGroupId,
    registrationState: registrationState === 'all' ? undefined : registrationState,
    deviceTypeId: deviceTypeId === 'all' ? undefined : deviceTypeId,
    parentDeviceKey: parentDeviceKey.trim() || undefined,
  };

  const { data, isLoading } = trpc.device.list.useQuery(listInput);
  const devices = (data ?? []) as Array<{
    deviceKey: string;
    canvasNodeId: string;
    deviceTypeId: string;
    registrationState: RegistrationState;
    realUuid: string | null;
    shadowUuid: string;
    parentDeviceKey: string | null;
    lastSeenAt: Date | null;
    simulationDesired: boolean;
  }>;

  const updateDevice = trpc.device.update.useMutation({
    onSuccess: () => void utils.device.list.invalidate({ orgId, siteGroupId }),
  });

  const deviceTypes = useMemo(() => listDeviceTypes(), []);

  return (
    <>
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Devices</h2>
        <Badge variant="secondary">{devices.length}</Badge>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <select value={registrationState} onChange={(e) => setRegistrationState(e.target.value as (typeof REG_STATES)[number])} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
          {REG_STATES.map((state) => <option key={state} value={state}>{state}</option>)}
        </select>
        <select value={deviceTypeId} onChange={(e) => setDeviceTypeId(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
          <option value="all">all device types</option>
          {deviceTypes.map((type) => <option key={type.id} value={type.id}>{type.id}</option>)}
        </select>
        <Input placeholder="parentDeviceKey" value={parentDeviceKey} onChange={(e) => setParentDeviceKey(e.target.value)} />
      </div>

      {isLoading ? <div className="text-sm text-muted-foreground">Loading devices…</div> : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="border-b">
                <th className="px-3 py-2 text-left">Label</th><th className="px-3 py-2 text-left">Category</th><th className="px-3 py-2 text-left">Device Type</th><th className="px-3 py-2 text-left">Registration</th><th className="px-3 py-2 text-left">Identity</th><th className="px-3 py-2 text-left">Parent</th><th className="px-3 py-2 text-left">Last Seen</th><th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => {
                const manifest = getDeviceType(device.deviceTypeId);
                const label = truncate(device.realUuid ?? device.shadowUuid, 16);
                const identity = device.registrationState === 'REGISTERED' ? (device.realUuid ?? '—') : truncate(device.shadowUuid, 12);
                const gw = gatewayList.data?.find((g) => g.canvasNodeId === device.canvasNodeId);
                return (
                  <tr key={device.deviceKey} className="border-b last:border-b-0">
                    <td className="px-3 py-2 font-mono text-xs">{label}</td>
                    <td className="px-3 py-2">{manifest?.category ?? 'unknown'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{device.deviceTypeId}</td>
                    <td className="px-3 py-2"><RegistrationBadge state={device.registrationState} /></td>
                    <td className="px-3 py-2 font-mono text-xs">{identity}</td>
                    <td className="px-3 py-2 font-mono text-xs">{truncate(device.parentDeviceKey, 12)}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{relativeTime(device.lastSeenAt)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-2">
                        <Button asChild size="sm" variant="outline"><Link href={`/orgs/${orgId}/projects/${projectId}/site-groups/${siteGroupId}?selectedNodeId=${encodeURIComponent(device.canvasNodeId)}`}>Open in canvas</Link></Button>
                        <Button
                          size="sm"
                          variant={device.simulationDesired ? 'default' : 'secondary'}
                          onClick={() => updateDevice.mutate({ orgId, deviceKey: device.deviceKey, simulationDesired: !device.simulationDesired })}
                          disabled={updateDevice.isPending}
                        >
                          Sim {device.simulationDesired ? 'On' : 'Off'}
                        </Button>
                        {gw ? <Button size="sm" variant="outline" onClick={() => setSerialGatewayId(gw.id)}>Connect</Button> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <LiveBrokerLog orgId={orgId} siteGroupId={siteGroupId} />
    </div>
    {serialGatewayId ? <ConnectSerialDialog open={!!serialGatewayId} onOpenChange={(o) => { if (!o) setSerialGatewayId(null); }} orgId={orgId} gatewayId={serialGatewayId} isSimulator={gatewayList.data?.find((g) => g.id === serialGatewayId)?.kind === 'simulator'} /> : null}
    </>
  );
}

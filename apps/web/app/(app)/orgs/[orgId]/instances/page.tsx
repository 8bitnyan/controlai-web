'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { trpc } from '@/lib/trpc/client';
import { Breadcrumb } from '@/components/layout/breadcrumb';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DeleteConfirmDialog } from '@/components/domain/delete-confirm-dialog';
import { ProvisionInstanceDialog } from '@/components/instances/provision-instance-dialog';
import { Server, Plus, Wifi, WifiOff, Activity, Loader2, AlertTriangle } from 'lucide-react';

const STATUS_CONFIG = {
  HEALTHY: { variant: 'success' as const, icon: Wifi, label: 'Healthy' },
  DEGRADED: { variant: 'warning' as const, icon: Activity, label: 'Degraded' },
  UNREACHABLE: { variant: 'destructive' as const, icon: WifiOff, label: 'Unreachable' },
  UNKNOWN: { variant: 'secondary' as const, icon: Activity, label: 'Unknown' },
  PROVISIONING: { variant: 'warning' as const, icon: Loader2, label: 'Provisioning', spin: true },
  PROVISION_FAILED: { variant: 'destructive' as const, icon: AlertTriangle, label: 'Failed' },
} as const;

type InstanceRow = {
  id: string;
  name: string;
  baseURL: string;
  status: keyof typeof STATUS_CONFIG;
  lastSeenAt: string | null;
  version: string | null;
  capacityUsedMB: number | null;
  capacityAllowedMB: number | null;
  env?: 'prod' | 'staging' | 'dev' | null;
  provisionProgress?: { stage: string; percent: number; log: Array<{ ts: string; message: string }> } | null;
};

export default function InstancesPage() {
  const { orgId } = useParams<{ orgId: string }>();

  const { data: instances, isLoading } = trpc.instance.list.useQuery({ orgId, includeLegacy: true });
  const utils = trpc.useUtils();
  const orgRole: 'OWNER' | null = 'OWNER';
  const orgSlug = orgId;

  const instancesWithEnv = (instances ?? []) as unknown as (InstanceRow & { legacy?: boolean })[];
  const activeInstances = instancesWithEnv.filter((i) => !i.legacy);
  const legacyInstances = instancesWithEnv.filter((i) => i.legacy);
  const hasDefaultInstance = activeInstances.length > 0;

  const existingEnvs = instancesWithEnv
    .filter((i) => i.env !== null)
    .map((i) => i.env as 'prod' | 'staging' | 'dev');

  const deleteInstance = trpc.instance.delete.useMutation({
    onSuccess: () => void utils.instance.list.invalidate({ orgId }),
  });

  const retryProvision = trpc.instance.retryProvision.useMutation({
    onSuccess: () => void utils.instance.list.invalidate({ orgId }),
  });

  const deprovisionInstance = trpc.instance.deprovision.useMutation({
    onSuccess: () => void utils.instance.list.invalidate({ orgId }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Breadcrumb segments={[{ label: 'Instances' }]} />
          <h1 className="mt-1 text-2xl font-bold">Controlai Instances</h1>
          {hasDefaultInstance && <Badge variant="success" className="mt-2">Sandbox daemon: HEALTHY (default)</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {!hasDefaultInstance && (
            <ProvisionInstanceDialog
              orgId={orgId}
              orgSlug={orgSlug}
              existingEnvs={existingEnvs}
              onProvisioned={() => void utils.instance.list.invalidate({ orgId, includeLegacy: true })}
            />
          )}
          <Button asChild variant="outline">
            <Link href={`/orgs/${orgId}/instances/new`}>
              <Plus className="mr-2 h-4 w-4" />
              Register existing daemon
            </Link>
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-36 rounded-lg" />)}
        </div>
      ) : activeInstances.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <Server className="mb-3 h-10 w-10 text-muted-foreground" />
          <p className="font-medium">No instances registered</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Register a controlai daemon to start managing your IoT stacks.
          </p>
        </div>
      ) : (
        <>
        <div className="grid gap-4 sm:grid-cols-2">
          {activeInstances.map((inst) => {
            const cfg = STATUS_CONFIG[inst.status] ?? STATUS_CONFIG.UNKNOWN;
            const StatusIcon = cfg.icon;

            return (
              <Card key={inst.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Server className="h-4 w-4 text-muted-foreground" />
                        {inst.name}
                      </CardTitle>
                      <CardDescription className="mt-1 text-xs truncate">
                        {inst.baseURL}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col items-end gap-1">
                        <Badge variant={cfg.variant} className="flex items-center gap-1">
                          <StatusIcon className={'spin' in cfg && cfg.spin ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
                          {cfg.label}
                        </Badge>
                        {inst.status === 'PROVISIONING' && inst.provisionProgress && (
                          <div className="flex w-40 flex-col gap-0.5">
                            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                              <span className="truncate capitalize">{inst.provisionProgress.stage.replace(/_/g, ' ')}</span>
                              <span className="tabular-nums">{inst.provisionProgress.percent}%</span>
                            </div>
                            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-primary transition-all duration-300"
                                style={{ width: `${Math.max(0, Math.min(100, inst.provisionProgress.percent))}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                      {inst.status === 'PROVISION_FAILED' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => retryProvision.mutate({ orgId, instanceId: inst.id })}
                          disabled={retryProvision.isPending}
                        >
                          Retry
                        </Button>
                      )}
                      {orgRole === 'OWNER' && inst.env !== null && (
                        <DeleteConfirmDialog
                          resourceName={`${inst.name}. This will tear down the Fly.io daemon and cannot be undone.`}
                          resourceType="managed daemon"
                          onConfirm={() =>
                            deprovisionInstance.mutateAsync({ instanceId: inst.id, orgId })
                          }
                          trigger={
                            <Button variant="destructive" size="sm">
                              Deprovision
                            </Button>
                          }
                        />
                      )}
                      <DeleteConfirmDialog
                        resourceName={inst.name}
                        resourceType="instance"
                        onConfirm={() =>
                          deleteInstance.mutateAsync({ instanceId: inst.id, orgId })
                        }
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1 text-xs text-muted-foreground">
                  {inst.version && <p>Version: {inst.version}</p>}
                  {inst.lastSeenAt && (
                    <p>Last seen: {new Date(inst.lastSeenAt).toLocaleString()}</p>
                  )}
                  {inst.capacityUsedMB != null && inst.capacityAllowedMB != null && (
                    <div className="space-y-1">
                      <p>
                        Capacity: {inst.capacityUsedMB} / {inst.capacityAllowedMB} MB
                      </p>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{
                            width: `${Math.min(100, (inst.capacityUsedMB / inst.capacityAllowedMB) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
        {legacyInstances.length > 0 && (
          <details className="mt-4 rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">Legacy instances ({legacyInstances.length})</summary>
            <div className="mt-2 space-y-2 text-xs text-muted-foreground">
              {legacyInstances.map((inst) => (
                <div key={inst.id} className="flex items-center gap-2">
                  <span>{inst.name}</span>
                  <Badge variant="outline">legacy</Badge>
                </div>
              ))}
            </div>
          </details>
        )}
        </>
      )}
    </div>
  );
}

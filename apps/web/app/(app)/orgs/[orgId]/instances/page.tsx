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
import { Server, Plus, Wifi, WifiOff, Activity } from 'lucide-react';

const STATUS_CONFIG = {
  HEALTHY: { variant: 'success' as const, icon: Wifi, label: 'Healthy' },
  DEGRADED: { variant: 'warning' as const, icon: Activity, label: 'Degraded' },
  UNREACHABLE: { variant: 'destructive' as const, icon: WifiOff, label: 'Unreachable' },
  UNKNOWN: { variant: 'secondary' as const, icon: Activity, label: 'Unknown' },
} as const;

export default function InstancesPage() {
  const { orgId } = useParams<{ orgId: string }>();

  const { data: instances, isLoading } = trpc.instance.list.useQuery({ orgId });
  const utils = trpc.useUtils();

  const deleteInstance = trpc.instance.delete.useMutation({
    onSuccess: () => void utils.instance.list.invalidate({ orgId }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Breadcrumb segments={[{ label: 'Instances' }]} />
          <h1 className="mt-1 text-2xl font-bold">Controlai Instances</h1>
        </div>
        <Button asChild>
          <Link href={`/orgs/${orgId}/instances/new`}>
            <Plus className="mr-2 h-4 w-4" />
            Register Instance
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-36 rounded-lg" />)}
        </div>
      ) : instances?.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <Server className="mb-3 h-10 w-10 text-muted-foreground" />
          <p className="font-medium">No instances registered</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Register a controlai daemon to start managing your IoT stacks.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {instances?.map((inst) => {
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
                      <Badge variant={cfg.variant} className="flex items-center gap-1">
                        <StatusIcon className="h-3 w-3" />
                        {cfg.label}
                      </Badge>
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
      )}
    </div>
  );
}

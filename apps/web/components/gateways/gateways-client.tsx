'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { GatewayDTO, GatewayStatus } from '@controlai-web/shared-types';
import { GatewayDialog } from './gateway-dialog';
import { Plus, Play, Square, Pencil, Trash2, ExternalLink } from 'lucide-react';
import Link from 'next/link';

interface GatewaysClientProps {
  orgId: string;
  siteGroupId: string;
}

function statusVariant(s: GatewayStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (s) {
    case 'connected':
      return 'default';
    case 'connecting':
      return 'secondary';
    case 'error':
      return 'destructive';
    default:
      return 'outline';
  }
}

export function GatewaysClient({ orgId, siteGroupId }: GatewaysClientProps) {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId;
  const [newOpen, setNewOpen] = useState(false);
  const [editGateway, setEditGateway] = useState<GatewayDTO | null>(null);

  const { data: gateways, isLoading } = trpc.gateway.list.useQuery({ orgId, siteGroupId });
  const utils = trpc.useUtils();

  const startMutation = trpc.gateway.start.useMutation({
    onSuccess: () => void utils.gateway.list.invalidate(),
  });
  const stopMutation = trpc.gateway.stop.useMutation({
    onSuccess: () => void utils.gateway.list.invalidate(),
  });
  const deleteMutation = trpc.gateway.delete.useMutation({
    onSuccess: () => void utils.gateway.list.invalidate(),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        Loading gateways…
      </div>
    );
  }

  const list = gateways ?? [];

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{list.length} gateway{list.length !== 1 ? 's' : ''}</p>
        <Button size="sm" onClick={() => setNewOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          New gateway
        </Button>
      </div>

      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          No gateways yet — click New gateway to add one.
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="border-b">
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Label</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Kind</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Mode</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Endpoint</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Last Error</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {list.map((gw) => (
                <tr key={gw.id} className="hover:bg-muted/20">
                  <td className="px-4 py-2 font-medium">{gw.label}</td>
                  <td className="px-4 py-2 text-muted-foreground capitalize">{gw.kind}</td>
                  <td className="px-4 py-2 text-xs font-mono text-muted-foreground">{gw.mode}</td>
                  <td className="px-4 py-2">
                    <Badge variant={statusVariant(gw.lastStatus)}>{gw.lastStatus}</Badge>
                  </td>
                  <td className="px-4 py-2 text-xs font-mono text-muted-foreground truncate max-w-[200px]" title={gw.endpointURL}>
                    {gw.endpointURL}
                  </td>
                  <td className="px-4 py-2 text-xs text-destructive truncate max-w-[160px]" title={gw.lastError ?? ''}>
                    {gw.lastError ?? '—'}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {gw.lastStatus === 'stopped' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          title="Start"
                          onClick={() => startMutation.mutate({ orgId, gatewayId: gw.id })}
                          disabled={startMutation.isPending}
                        >
                          <Play className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          title="Stop"
                          onClick={() => stopMutation.mutate({ orgId, gatewayId: gw.id })}
                          disabled={stopMutation.isPending}
                        >
                          <Square className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Link href={`/orgs/${orgId}/projects/${projectId}/site-groups/${siteGroupId}/gateways/${gw.id}`}>
                        <Button size="sm" variant="ghost" title="상세 / 보드에 설치">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Edit"
                        onClick={() => setEditGateway(gw)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Delete"
                        onClick={() => {
                          if (confirm(`Delete gateway "${gw.label}"?`)) {
                            deleteMutation.mutate({ orgId, gatewayId: gw.id });
                          }
                        }}
                        disabled={deleteMutation.isPending}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {newOpen && (
        <GatewayDialog
          open={newOpen}
          onClose={() => setNewOpen(false)}
          orgId={orgId}
          siteGroupId={siteGroupId}
        />
      )}

      {editGateway && (
        <GatewayDialog
          open={!!editGateway}
          onClose={() => setEditGateway(null)}
          orgId={orgId}
          siteGroupId={siteGroupId}
          existing={editGateway}
        />
      )}
    </>
  );
}

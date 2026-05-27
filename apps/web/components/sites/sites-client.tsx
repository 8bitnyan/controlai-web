'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { MoreHorizontal, Copy } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export function SitesClient({ orgId, projectId, siteGroupId }: { orgId: string; projectId: string; siteGroupId: string }) {
  const utils = trpc.useUtils();
  const { data: sites = [], isLoading } = trpc.site.list.useQuery({ orgId, siteGroupId });
  const { data: rawNodeConfig } = trpc.nodeConfig.load.useQuery({ orgId, siteGroupId });
  const nodeConfig = rawNodeConfig as { nodes?: Array<{ id: string }> } | null | undefined;
  const unbind = trpc.site.unbind.useMutation({ onSuccess: () => void utils.site.list.invalidate({ orgId, siteGroupId }) });
  const del = trpc.site.delete.useMutation({ onSuccess: () => void utils.site.list.invalidate({ orgId, siteGroupId }) });

  const nodeIds = useMemo(() => new Set(((nodeConfig?.nodes as Array<{ id: string }> | undefined) ?? []).map((n) => n.id)), [nodeConfig?.nodes]);

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading sites…</div>;
  if (sites.length === 0) return <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">No sites yet. Add broker nodes to the canvas and click Apply.</div>;

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">Sites in this group</h2>
        <p className="text-xs text-muted-foreground">Sites represent distinct broker infrastructure instances mapped to your canvas broker nodes.</p>
      </div>
      <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50"><tr className="border-b"><th className="px-3 py-2 text-left">Node / Name</th><th className="px-3 py-2 text-left">Kind</th><th className="px-3 py-2 text-left">Site ID</th><th className="px-3 py-2 text-left">Tenant ID</th><th className="px-3 py-2 text-left">SNI</th><th className="px-3 py-2 text-left">Bridge Cert</th><th className="px-3 py-2 text-right">Actions</th></tr></thead>
        <tbody>
          {sites.map((site) => {
            const orphan = Boolean(site.canvasNodeId && !nodeIds.has(site.canvasNodeId));
            return (
              <tr key={site.id} className="border-b last:border-b-0">
                <td className="px-3 py-2 text-xs">
                  <div className="font-medium">{site.name}</div>
                  <div className="text-muted-foreground font-mono">{site.canvasNodeId ?? 'Unbound'}</div>
                  {orphan && <div className="text-amber-600">Drift: bound node missing from canvas</div>}
                </td>
                <td className="px-3 py-2">{site.brokerKind ?? '—'}</td>
                <td className="px-3 py-2 text-xs font-mono">{site.controlaiSiteId ?? '—'} {site.controlaiSiteId && <CopyBtn value={site.controlaiSiteId} />}</td>
                <td className="px-3 py-2 text-xs font-mono">{site.controlaiTenantId ?? '—'} {site.controlaiTenantId && <CopyBtn value={site.controlaiTenantId} />}</td>
                <td className="px-3 py-2 text-xs font-mono" title={site.tlsServername ?? ''}>{site.tlsServername ? `${site.tlsServername.slice(0, 24)}…` : '—'} {site.tlsServername && <CopyBtn value={site.tlsServername} />}</td>
                <td className="px-3 py-2"><Badge variant={site.hasMqttCert ? 'default' : 'secondary'}>{site.hasMqttCert ? 'Present' : 'Missing'}</Badge></td>
                <td className="px-3 py-2 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="sm"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem disabled>Issue mqtt-bridge cert (Coming soon)</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => unbind.mutate({ siteId: site.id })}>Detach from canvas</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => del.mutate({ orgId, siteId: site.id })} disabled={Boolean(site.controlaiTenantId)}>Delete site</DropdownMenuItem>
                      <DropdownMenuItem asChild><Link href={`/orgs/${orgId}/projects/${projectId}/site-groups/${siteGroupId}`}>Open in Canvas</Link></DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function CopyBtn({ value }: { value: string }) {
  return <button type="button" className="ml-1 align-middle opacity-70 hover:opacity-100" onClick={() => void navigator.clipboard.writeText(value)}><Copy className="h-3 w-3" /></button>;
}

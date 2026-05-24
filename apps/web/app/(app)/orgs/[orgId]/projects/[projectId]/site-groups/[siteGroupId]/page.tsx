'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { Breadcrumb } from '@/components/layout/breadcrumb';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { DeleteConfirmDialog } from '@/components/domain/delete-confirm-dialog';
import { SiteForm } from '@/components/domain/site-form';
import { Radio, Plus } from 'lucide-react';

export default function SiteGroupDetailPage() {
  const { orgId, projectId, siteGroupId } = useParams<{
    orgId: string;
    projectId: string;
    siteGroupId: string;
  }>();

  const [createOpen, setCreateOpen] = useState(false);

  const { data: sites, isLoading } = trpc.site.list.useQuery({
    siteGroupId,
    orgId,
  });
  const utils = trpc.useUtils();

  const deleteSite = trpc.site.delete.useMutation({
    onSuccess: () => void utils.site.list.invalidate({ siteGroupId, orgId }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Breadcrumb
            segments={[
              { label: 'Projects', href: `/orgs/${orgId}/projects` },
              { label: 'Project', href: `/orgs/${orgId}/projects/${projectId}` },
              { label: 'Site Group' },
            ]}
          />
          <h1 className="mt-1 text-2xl font-bold">Sites</h1>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Site
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a new site</DialogTitle>
            </DialogHeader>
            <SiteForm
              orgId={orgId}
              siteGroupId={siteGroupId}
              onSuccess={() => setCreateOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
        </div>
      ) : sites?.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <Radio className="mb-3 h-10 w-10 text-muted-foreground" />
          <p className="font-medium">No sites yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a site to represent a physical broker deployment.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Broker</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sites?.map((site) => (
                <tr key={site.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3 font-medium">{site.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {site.brokerKind ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    {site.controlaiTenantId ? (
                      <Badge variant="success">Provisioned</Badge>
                    ) : (
                      <Badge variant="secondary">Not provisioned</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <DeleteConfirmDialog
                      resourceName={site.name}
                      resourceType="site"
                      onConfirm={() =>
                        deleteSite.mutateAsync({ siteId: site.id, orgId })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

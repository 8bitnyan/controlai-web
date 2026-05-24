'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { trpc } from '@/lib/trpc/client';
import { Breadcrumb } from '@/components/layout/breadcrumb';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { DeleteConfirmDialog } from '@/components/domain/delete-confirm-dialog';
import { Layers, Plus, Loader2 } from 'lucide-react';

export default function ProjectDetailPage() {
  const { orgId, projectId } = useParams<{ orgId: string; projectId: string }>();
  const [createOpen, setCreateOpen] = useState(false);
  const [siteGroupName, setSiteGroupName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const { data: siteGroups, isLoading } = trpc.siteGroup.list.useQuery({
    projectId,
    orgId,
  });
  const utils = trpc.useUtils();

  const createSiteGroup = trpc.siteGroup.create.useMutation({
    onSuccess: () => {
      void utils.siteGroup.list.invalidate({ projectId, orgId });
      setCreateOpen(false);
      setSiteGroupName('');
    },
  });

  const deleteSiteGroup = trpc.siteGroup.delete.useMutation({
    onSuccess: () =>
      void utils.siteGroup.list.invalidate({ projectId, orgId }),
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    try {
      await createSiteGroup.mutateAsync({ projectId, name: siteGroupName, orgId });
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create site group');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Breadcrumb
            segments={[
              { label: 'Projects', href: `/orgs/${orgId}/projects` },
              { label: 'Project' },
            ]}
          />
          <h1 className="mt-1 text-2xl font-bold">Site Groups</h1>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Site Group
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a new site group</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              {createError && (
                <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {createError}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="sg-name">Site group name</Label>
                <Input
                  id="sg-name"
                  required
                  value={siteGroupName}
                  onChange={(e) => setSiteGroupName(e.target.value)}
                  placeholder="Factory A"
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createSiteGroup.isPending}>
                  {createSiteGroup.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating…</>
                  ) : (
                    'Create'
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)}
        </div>
      ) : siteGroups?.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <Layers className="mb-3 h-10 w-10 text-muted-foreground" />
          <p className="font-medium">No site groups yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a site group to organise your physical deployments.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {siteGroups?.map((sg) => (
            <Card key={sg.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/orgs/${orgId}/projects/${projectId}/site-groups/${sg.id}`}
                    className="flex-1"
                  >
                    <CardTitle className="text-base hover:underline">{sg.name}</CardTitle>
                  </Link>
                  <DeleteConfirmDialog
                    resourceName={sg.name}
                    resourceType="site group"
                    onConfirm={() =>
                      deleteSiteGroup.mutateAsync({ siteGroupId: sg.id, orgId })
                    }
                  />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  {sg._count.sites} site{sg._count.sites !== 1 && 's'}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

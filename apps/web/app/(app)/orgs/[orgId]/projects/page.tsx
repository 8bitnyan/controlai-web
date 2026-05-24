'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { trpc } from '@/lib/trpc/client';
import { Breadcrumb } from '@/components/layout/breadcrumb';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { FolderOpen, Plus, Loader2, Server } from 'lucide-react';

export default function ProjectsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [createOpen, setCreateOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [instanceId, setInstanceId] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const { data: projects, isLoading: projectsLoading } = trpc.project.list.useQuery({ orgId });
  const { data: instances } = trpc.instance.list.useQuery({ orgId });
  const utils = trpc.useUtils();

  const createProject = trpc.project.create.useMutation({
    onSuccess: () => {
      void utils.project.list.invalidate({ orgId });
      setCreateOpen(false);
      setProjectName('');
      setInstanceId('');
    },
  });

  const deleteProject = trpc.project.delete.useMutation({
    onSuccess: () => void utils.project.list.invalidate({ orgId }),
  });

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    try {
      await createProject.mutateAsync({ orgId, instanceId, name: projectName });
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create project');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Breadcrumb segments={[{ label: 'Projects' }]} />
          <h1 className="mt-1 text-2xl font-bold">Projects</h1>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Project
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a new project</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreateProject} className="space-y-4">
              {createError && (
                <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {createError}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="project-name">Project name</Label>
                <Input
                  id="project-name"
                  required
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="My Project"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="instance-select">Controlai instance</Label>
                <select
                  id="instance-select"
                  required
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={instanceId}
                  onChange={(e) => setInstanceId(e.target.value)}
                >
                  <option value="">Select an instance</option>
                  {instances?.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.name} ({inst.status})
                    </option>
                  ))}
                </select>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createProject.isPending}>
                  {createProject.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating…</>
                  ) : (
                    'Create project'
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {projectsLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      ) : projects?.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <FolderOpen className="mb-3 h-10 w-10 text-muted-foreground" />
          <p className="font-medium">No projects yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first project to get started.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects?.map((project) => (
            <Card key={project.id} className="group relative">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/orgs/${orgId}/projects/${project.id}`}
                    className="flex-1"
                  >
                    <CardTitle className="line-clamp-1 text-base hover:underline">
                      {project.name}
                    </CardTitle>
                  </Link>
                  <DeleteConfirmDialog
                    resourceName={project.name}
                    resourceType="project"
                    onConfirm={() =>
                      deleteProject.mutateAsync({ projectId: project.id })
                    }
                  />
                </div>
                <CardDescription className="flex items-center gap-1.5 text-xs">
                  <Server className="h-3 w-3" />
                  {project.instance.name}
                  <Badge
                    variant={
                      project.instance.status === 'HEALTHY'
                        ? 'success'
                        : project.instance.status === 'UNREACHABLE'
                          ? 'destructive'
                          : 'secondary'
                    }
                    className="ml-1 text-xs"
                  >
                    {project.instance.status}
                  </Badge>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  {project._count.siteGroups} site group
                  {project._count.siteGroups !== 1 && 's'}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

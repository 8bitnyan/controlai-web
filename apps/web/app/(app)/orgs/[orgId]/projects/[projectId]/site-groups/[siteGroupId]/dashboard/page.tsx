import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth-server';
import { prisma } from '@controlai-web/db';
import { DashboardGrid } from '@/components/dashboard/dashboard-grid';
import { Breadcrumb } from '@/components/layout/breadcrumb';

interface Props {
  params: Promise<{
    orgId: string;
    projectId: string;
    siteGroupId: string;
  }>;
}

export default async function DashboardPage({ params }: Props) {
  const { orgId, projectId, siteGroupId } = await params;

  const session = await getSession();
  if (!session?.user) redirect('/sign-in');

  // Verify membership and get org role
  const membership = await prisma.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId: session.user.id } },
  });
  if (!membership) redirect(`/orgs/${orgId}/projects`);

  const isReadOnly = membership.role === 'MEMBER';

  // Get SiteGroup + related Project + Instance
  const siteGroup = await prisma.siteGroup.findFirst({
    where: { id: siteGroupId, project: { orgId } },
    include: {
      project: { include: { instance: true } },
      sites: { take: 1 },
    },
  });
  if (!siteGroup) redirect(`/orgs/${orgId}/projects/${projectId}`);

  const instanceId = siteGroup.project.instanceId;
  const siteId = siteGroup.sites[0]?.id;

  return (
    <div className="space-y-6 p-6">
      <div>
        <Breadcrumb
          segments={[
            { label: 'Projects', href: `/orgs/${orgId}/projects` },
            { label: siteGroup.project.name, href: `/orgs/${orgId}/projects/${projectId}` },
            {
              label: siteGroup.name,
              href: `/orgs/${orgId}/projects/${projectId}/site-groups/${siteGroupId}`,
            },
            { label: 'Dashboard' },
          ]}
        />
        <h1 className="mt-1 text-2xl font-bold">{siteGroup.name} — Dashboard</h1>
      </div>

      <DashboardGrid
        orgId={orgId}
        siteGroupId={siteGroupId}
        instanceId={instanceId}
        siteId={siteId}
        isReadOnly={isReadOnly}
      />
    </div>
  );
}

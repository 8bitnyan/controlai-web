import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth-server';
import { prisma } from '@controlai-web/db';
import { GatewaysClient } from '@/components/gateways/gateways-client';
import { Breadcrumb } from '@/components/layout/breadcrumb';

interface Props {
  params: Promise<{
    orgId: string;
    projectId: string;
    siteGroupId: string;
  }>;
}

export default async function GatewaysPage({ params }: Props) {
  const { orgId, projectId, siteGroupId } = await params;

  const session = await getSession();
  if (!session?.user) redirect('/sign-in');

  const membership = await prisma.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId: session.user.id } },
  });
  if (!membership) redirect(`/orgs/${orgId}/projects`);

  const siteGroup = await prisma.siteGroup.findFirst({
    where: { id: siteGroupId, project: { orgId } },
    include: { project: true },
  });
  if (!siteGroup) redirect(`/orgs/${orgId}/projects/${projectId}`);

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
            { label: 'Gateways' },
          ]}
        />
        <h1 className="mt-1 text-2xl font-bold">{siteGroup.name} — Gateways</h1>
      </div>

      <GatewaysClient orgId={orgId} siteGroupId={siteGroupId} />
    </div>
  );
}

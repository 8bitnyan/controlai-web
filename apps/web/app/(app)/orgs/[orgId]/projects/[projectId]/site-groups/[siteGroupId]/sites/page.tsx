import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth-server';
import { prisma } from '@controlai-web/db';
import { SitesClient } from '@/components/sites/sites-client';

interface Props {
  params: Promise<{ orgId: string; projectId: string; siteGroupId: string }>;
}

export default async function SitesPage({ params }: Props) {
  const { orgId, projectId, siteGroupId } = await params;
  const session = await getSession();
  if (!session?.user) redirect('/sign-in');

  const membership = await prisma.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId: session.user.id } },
  });
  if (!membership) redirect(`/orgs/${orgId}/projects`);

  const siteGroup = await prisma.siteGroup.findFirst({
    where: { id: siteGroupId, project: { orgId } },
  });
  if (!siteGroup) redirect(`/orgs/${orgId}/projects/${projectId}`);

  return (
    <div className="p-6 space-y-4">
      <SitesClient orgId={orgId} projectId={projectId} siteGroupId={siteGroupId} />
    </div>
  );
}

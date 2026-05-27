import { redirect } from 'next/navigation';
import { prisma } from '@controlai-web/db';
import { getSession } from '@/lib/auth-server';
import { createServerCaller } from '@/lib/trpc/server';
import { GatewayDetailClient } from '@/components/gateways/gateway-detail-client';

interface Props {
  params: Promise<{
    orgId: string;
    projectId: string;
    siteGroupId: string;
    gatewayId: string;
  }>;
}

export default async function GatewayDetailPage({ params }: Props) {
  const { orgId, projectId, siteGroupId, gatewayId } = await params;

  const session = await getSession();
  if (!session?.user) redirect('/sign-in');

  const membership = await prisma.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId: session.user.id } },
  });
  if (!membership) redirect(`/orgs/${orgId}/projects`);

  const caller = await createServerCaller();
  let gateway: Awaited<ReturnType<typeof caller.gateway.get>> | null = null;
  try {
    gateway = await caller.gateway.get({ orgId, gatewayId });
  } catch {
    gateway = null;
  }

  if (!gateway || gateway.siteGroupId !== siteGroupId) {
    redirect(`/orgs/${orgId}/projects/${projectId}/site-groups/${siteGroupId}/gateways`);
  }

  return (
    <GatewayDetailClient
      gatewayId={gatewayId}
      orgId={orgId}
      projectId={projectId}
      siteGroupId={siteGroupId}
    />
  );
}

import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth-server';
import { getSetupState } from '@controlai-web/api';
import { prisma } from '@controlai-web/db';

export default async function HomePage() {
  const session = await getSession();

  if (!session?.user) {
    redirect('/sign-in');
  }

  const state = await getSetupState(prisma);
  if (!state.isComplete) {
    redirect('/setup');
  }

  // Redirect to first org dashboard (setup ensures at least one org exists)
  const firstMembership = await prisma.organizationMember.findFirst({
    where: { userId: session.user.id },
    include: { org: true },
    orderBy: { createdAt: 'asc' },
  });

  if (firstMembership) {
    redirect(`/orgs/${firstMembership.orgId}/projects`);
  }

  redirect('/setup');
}

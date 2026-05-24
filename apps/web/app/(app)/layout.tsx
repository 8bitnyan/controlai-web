import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth-server';
import { prisma } from '@controlai-web/db';
import { AppShell } from '@/components/layout/app-shell';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session?.user) {
    redirect('/sign-in');
  }

  const memberships = await prisma.organizationMember.findMany({
    where: { userId: session.user.id },
    include: { org: true },
    orderBy: { createdAt: 'asc' },
  });

  const orgs = memberships.map((m) => m.org);
  const firstOrg = orgs[0];

  // If no org, redirect to setup
  if (!firstOrg) {
    redirect('/setup');
  }

  const projects = await prisma.project.findMany({
    where: { orgId: firstOrg.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  });

  return (
    <AppShell currentOrg={firstOrg} orgs={orgs} projects={projects}>
      {children}
    </AppShell>
  );
}

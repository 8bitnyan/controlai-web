import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth-server';
import { prisma } from '@controlai-web/db';
import { Breadcrumb } from '@/components/layout/breadcrumb';
import { SiteGroupTabClient } from './site-group-tab-client';

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{
    orgId: string;
    projectId: string;
    siteGroupId: string;
  }>;
}

const TABS = [
  { label: 'Canvas', suffix: '' },
  { label: 'Sites', suffix: '/sites' },
  { label: 'Devices', suffix: '/devices' },
  { label: 'Dashboard', suffix: '/dashboard' },
  { label: 'Gateways', suffix: '/gateways' },
] as const;

export default async function SiteGroupLayout({ children, params }: LayoutProps) {
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

  const base = `/orgs/${orgId}/projects/${projectId}/site-groups/${siteGroupId}`;

  return (
    <div className="flex flex-col h-full">
      {/* Header + tabs */}
      <div className="px-6 pt-5 pb-0 border-b bg-background">
        <Breadcrumb
          segments={[
            { label: 'Projects', href: `/orgs/${orgId}/projects` },
            { label: siteGroup.project.name, href: `/orgs/${orgId}/projects/${projectId}` },
            { label: siteGroup.name },
          ]}
        />
        <h1 className="mt-1 text-xl font-bold">{siteGroup.name}</h1>

        {/* Tab row */}
        <nav className="flex gap-0 mt-3 -mb-px" aria-label="Site group sections">
          {TABS.map(({ label, suffix }) => {
            const href = `${base}${suffix}`;
            return (
              <SiteGroupTabClient
                key={href}
                href={href}
                label={label}
                base={base}
                suffix={suffix}
              />
            );
          })}
        </nav>
      </div>

      {/* Page content */}
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}

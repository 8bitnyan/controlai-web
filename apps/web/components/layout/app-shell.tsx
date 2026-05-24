'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserMenu } from '@/components/auth/user-menu';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Server,
  Settings,
  FolderOpen,
  ChevronDown,
} from 'lucide-react';

interface OrgInfo {
  id: string;
  name: string;
  slug: string;
}

interface ProjectInfo {
  id: string;
  name: string;
}

interface AppShellProps {
  children: React.ReactNode;
  currentOrg?: OrgInfo;
  orgs?: OrgInfo[];
  projects?: ProjectInfo[];
}

export function AppShell({
  children,
  currentOrg,
  orgs = [],
  projects = [],
}: AppShellProps) {
  const pathname = usePathname();

  const sidebarLinks = currentOrg
    ? [
        {
          label: 'Projects',
          href: `/orgs/${currentOrg.id}/projects`,
          icon: FolderOpen,
        },
        {
          label: 'Instances',
          href: `/orgs/${currentOrg.id}/instances`,
          icon: Server,
        },
        {
          label: 'Settings',
          href: `/orgs/${currentOrg.id}/settings`,
          icon: Settings,
        },
      ]
    : [];

  return (
    <div className="flex min-h-screen flex-col">
      {/* Top navigation bar */}
      <header className="sticky top-0 z-40 flex h-14 items-center border-b bg-background px-4 gap-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <LayoutDashboard className="h-5 w-5 text-primary" />
          <span className="hidden sm:block">controlai</span>
        </Link>

        <Separator orientation="vertical" className="h-6" />

        {/* Org switcher */}
        {currentOrg && (
          <div className="flex items-center gap-1">
            <button className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium hover:bg-accent">
              <span className="max-w-[140px] truncate">{currentOrg.name}</span>
              {orgs.length > 1 && <ChevronDown className="h-3.5 w-3.5 opacity-60" />}
            </button>
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* User menu */}
        <UserMenu />
      </header>

      <div className="flex flex-1">
        {/* Left sidebar */}
        {currentOrg && (
          <aside className="hidden w-56 flex-shrink-0 border-r bg-background/50 lg:flex lg:flex-col">
            <nav className="flex flex-col gap-1 p-3">
              {sidebarLinks.map((link) => {
                const Icon = link.icon;
                const isActive = pathname.startsWith(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    {link.label}
                  </Link>
                );
              })}

              {projects.length > 0 && (
                <>
                  <Separator className="my-1" />
                  <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Projects
                  </p>
                  {projects.map((project) => (
                    <Link
                      key={project.id}
                      href={`/orgs/${currentOrg.id}/projects/${project.id}`}
                      className={cn(
                        'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                        pathname.includes(project.id)
                          ? 'bg-accent text-accent-foreground'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                      )}
                    >
                      <FolderOpen className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="truncate">{project.name}</span>
                    </Link>
                  ))}
                </>
              )}
            </nav>
          </aside>
        )}

        {/* Main content */}
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}

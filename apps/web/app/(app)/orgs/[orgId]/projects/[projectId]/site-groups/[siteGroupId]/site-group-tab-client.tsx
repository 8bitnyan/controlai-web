'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

interface SiteGroupTabClientProps {
  href: string;
  label: string;
  base: string;
  suffix: string;
}

export function SiteGroupTabClient({ href, label, base, suffix }: SiteGroupTabClientProps) {
  const pathname = usePathname();

  // Exact match for canvas (no suffix), prefix match for others
  const isActive =
    suffix === ''
      ? pathname === base || pathname === base + '/'
      : pathname.startsWith(href);

  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
        isActive
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground',
      )}
      aria-current={isActive ? 'page' : undefined}
    >
      {label}
    </Link>
  );
}

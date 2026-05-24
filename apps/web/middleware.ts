import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@controlai-web/api';

const PUBLIC_PATHS = [
  '/sign-in',
  '/sign-up',
  '/setup',
  '/api/auth',
  '/api/trpc',
  '/api/setup-state',
  '/api/cron',
  '/_next',
  '/favicon.ico',
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const session = await auth.api.getSession({ headers: req.headers });

  if (!session?.user) {
    const signInUrl = new URL('/sign-in', req.url);
    signInUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(signInUrl);
  }

  // Check if user needs to complete setup (has no org)
  // Note: full setup state check is done server-side in the setup wizard page
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

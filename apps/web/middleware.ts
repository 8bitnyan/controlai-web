import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

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

  // Lightweight cookie presence check — edge-compatible (no DB).
  // The server components / route handlers do the full session validation
  // via auth.api.getSession with the full Node runtime.
  const sessionCookie = getSessionCookie(req);

  if (!sessionCookie) {
    const signInUrl = new URL('/sign-in', req.url);
    signInUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

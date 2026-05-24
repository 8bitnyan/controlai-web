import { createCallerFactory } from '@trpc/server';
import { appRouter, createTRPCContext } from '@controlai-web/api';
import { headers } from 'next/headers';
import type { NextRequest } from 'next/server';

/**
 * Create a tRPC caller for use in Server Components and Server Actions.
 */
export async function createServerCaller() {
  const headerList = await headers();
  // Build a synthetic Request to satisfy createTRPCContext
  const req = new Request('http://internal/trpc', {
    headers: headerList,
  }) as NextRequest;

  const ctx = await createTRPCContext({
    req,
    resHeaders: new Headers(),
  });

  const callerFactory = createCallerFactory(appRouter);
  return callerFactory(ctx);
}

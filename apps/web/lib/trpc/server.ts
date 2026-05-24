import { appRouter, createTRPCContext } from '@controlai-web/api';
import { headers } from 'next/headers';

/**
 * Create a tRPC caller for use in Server Components and Server Actions.
 */
export async function createServerCaller() {
  const headerList = await headers();
  const req = new Request('http://internal/trpc', { headers: headerList });
  const ctx = await createTRPCContext({ req });
  return appRouter.createCaller(ctx);
}

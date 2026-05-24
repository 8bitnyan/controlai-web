import type { inferAsyncReturnType } from '@trpc/server';
import { auth } from './auth';
import { prisma } from '@controlai-web/db';

export async function createTRPCContext(opts: { req: Request }) {
  const session = await auth.api.getSession({ headers: opts.req.headers });

  return {
    prisma,
    session,
    userId: session?.user?.id ?? null,
    req: opts.req,
  };
}

export type TRPCContext = inferAsyncReturnType<typeof createTRPCContext>;

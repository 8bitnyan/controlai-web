import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter, createTRPCContext, onErrorHandler } from '@controlai-web/api';
import type { NextRequest } from 'next/server';

const handler = (req: NextRequest) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: ({ req, resHeaders }) =>
      createTRPCContext({ req: req as NextRequest, resHeaders }),
    onError: onErrorHandler,
  });

export { handler as GET, handler as POST };

import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import {
  appRouter,
  createTRPCContext,
  enforceGatewayDeviceKeyStartupGate,
  onErrorHandler,
  startDeviceCanvasReconcileJob,
  startRegistrationProposalExpireJob,
} from '@controlai-web/api';
import type { NextRequest } from 'next/server';

const startupGatePromise = enforceGatewayDeviceKeyStartupGate();

declare global {
  // eslint-disable-next-line no-var
  var __deviceReconcileCleanup: (() => void) | null | undefined;
  // eslint-disable-next-line no-var
  var __registrationExpireCleanup: (() => void) | undefined;
}

if (process.env.ENABLE_DEVICE_RECONCILE === 'true' && !globalThis.__deviceReconcileCleanup) {
  globalThis.__deviceReconcileCleanup = startDeviceCanvasReconcileJob() ?? null;
}

if (!globalThis.__registrationExpireCleanup) {
  globalThis.__registrationExpireCleanup = startRegistrationProposalExpireJob({}) ?? undefined;
}

const handler = async (req: NextRequest) => {
  await startupGatePromise;
  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: ({ req }) => createTRPCContext({ req }),
    onError: onErrorHandler,
  });
};

export { handler as GET, handler as POST };

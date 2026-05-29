import { router } from './trpc';
import { orgRouter } from './routers/org';
import { projectRouter } from './routers/project';
import { siteGroupRouter } from './routers/siteGroup';
import { siteRouter } from './routers/site';
import { instanceRouter } from './routers/instance';
import { auditRouter } from './routers/audit';
import { nodeConfigRouter } from './routers/nodeConfig';
import { applyRouter } from './routers/apply';
import { streamRouter } from './routers/stream';
import { telemetryRouter } from './routers/telemetry';
import { dashboardRouter } from './routers/dashboard';
import { gatewayRouter } from './routers/gateway';
import { deviceRouter } from './routers/device';
import { adminRouter } from './routers/admin';

export const appRouter = router({
  org: orgRouter,
  project: projectRouter,
  siteGroup: siteGroupRouter,
  site: siteRouter,
  instance: instanceRouter,
  audit: auditRouter,
  nodeConfig: nodeConfigRouter,
  provision: applyRouter,
  stream: streamRouter,
  telemetry: telemetryRouter,
  dashboard: dashboardRouter,
  gateway: gatewayRouter,
  device: deviceRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;

import { router } from './trpc';
import { orgRouter } from './routers/org';
import { projectRouter } from './routers/project';
import { siteGroupRouter } from './routers/siteGroup';
import { siteRouter } from './routers/site';
import { instanceRouter } from './routers/instance';
import { auditRouter } from './routers/audit';

export const appRouter = router({
  org: orgRouter,
  project: projectRouter,
  siteGroup: siteGroupRouter,
  site: siteRouter,
  instance: instanceRouter,
  audit: auditRouter,
});

export type AppRouter = typeof appRouter;

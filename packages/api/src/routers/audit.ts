import { router, orgProcedure } from '../trpc';
import { ListAuditSchema } from '@controlai-web/shared-types';

export const auditRouter = router({
  /**
   * List audit log entries for an org (read-only in v1; no UI, visible via Prisma Studio).
   */
  list: orgProcedure
    .input(ListAuditSchema)
    .query(async ({ ctx, input }) => {
      return ctx.prisma.auditLog.findMany({
        where: {
          orgId: input.orgId,
          ...(input.action ? { action: input.action } : {}),
          ...(input.from || input.to
            ? {
                createdAt: {
                  ...(input.from ? { gte: new Date(input.from) } : {}),
                  ...(input.to ? { lte: new Date(input.to) } : {}),
                },
              }
            : {}),
          ...(input.cursor ? { id: { lt: input.cursor } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: input.limit,
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });
    }),
});

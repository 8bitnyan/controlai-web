import { PrismaClient } from '@prisma/client';
import prisma from '../src/client';

export async function backfillGatewayDeviceKeys(db: PrismaClient, siteGroupId?: string): Promise<number> {
  const gateways = await db.gateway.findMany({ where: { deviceKey: null, ...(siteGroupId ? { siteGroupId } : {}) } });
  let linked = 0;

  for (const gateway of gateways) {
    const existing = await db.device.findFirst({
      where: { siteGroupId: gateway.siteGroupId, canvasNodeId: `migrated-gateway-${gateway.id}` },
      select: { deviceKey: true },
    });
    if (!existing) continue;
    await db.gateway.update({ where: { id: gateway.id }, data: { deviceKey: existing.deviceKey } });
    linked += 1;
  }

  return linked;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argIdx = process.argv.findIndex((arg) => arg === '--site-group');
  const siteGroupId = argIdx >= 0 ? process.argv[argIdx + 1] : undefined;
  backfillGatewayDeviceKeys(prisma, siteGroupId)
    .then(() => process.exit(0))
    .catch(() => process.exit(2));
}

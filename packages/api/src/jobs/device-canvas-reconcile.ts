import { prisma } from '@controlai-web/db';
import { writeAudit } from '../lib/audit-writer';

type ReconcileOptions = {
  intervalMs?: number;
};

type CanvasNode = { id?: string };

function extractCanvasNodeIds(nodes: unknown): string[] {
  if (!Array.isArray(nodes)) return [];
  return nodes
    .map((node) => (node as CanvasNode).id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

async function runReconcileTick(): Promise<void> {
  const activeConfigs = await prisma.nodeConfig.findMany({
    where: { isActive: true },
    select: {
      siteGroupId: true,
      nodes: true,
      siteGroup: {
        select: {
          project: {
            select: {
              orgId: true,
            },
          },
        },
      },
    },
  });

  for (const config of activeConfigs) {
    const canvasNodeIds = new Set(extractCanvasNodeIds(config.nodes));
    const devices = await prisma.device.findMany({
      where: {
        siteGroupId: config.siteGroupId,
        registrationState: { not: 'ORPHANED' },
      },
      select: { canvasNodeId: true },
    });
    const deviceNodeIds = new Set(devices.map((device) => device.canvasNodeId));

    const canvasMissingDevice = [...canvasNodeIds].filter((id) => !deviceNodeIds.has(id));
    const deviceMissingCanvas = [...deviceNodeIds].filter((id) => !canvasNodeIds.has(id));

    if (canvasMissingDevice.length > 0) {
      await writeAudit(prisma, {
        orgId: config.siteGroup.project.orgId,
        action: 'device.reconcile-mismatch',
        targetId: config.siteGroupId,
        targetType: 'siteGroup',
        metadata: {
          siteGroupId: config.siteGroupId,
          kind: 'canvas-missing-device',
          count: canvasMissingDevice.length,
          ids: canvasMissingDevice,
        },
      });
    }

    if (deviceMissingCanvas.length > 0) {
      await writeAudit(prisma, {
        orgId: config.siteGroup.project.orgId,
        action: 'device.reconcile-mismatch',
        targetId: config.siteGroupId,
        targetType: 'siteGroup',
        metadata: {
          siteGroupId: config.siteGroupId,
          kind: 'device-missing-canvas',
          count: deviceMissingCanvas.length,
          ids: deviceMissingCanvas,
        },
      });
    }
  }
}

export function startDeviceCanvasReconcileJob({ intervalMs = 60_000 }: ReconcileOptions = {}): (() => void) | null {
  if (process.env.ENABLE_DEVICE_RECONCILE !== 'true') return null;

  void runReconcileTick();
  const timer = setInterval(() => {
    void runReconcileTick();
  }, intervalMs);

  return () => clearInterval(timer);
}

import { prisma } from '@controlai-web/db';
import { reconcileSiteGroup } from './manager.js';

type DeviceSnapshot = Map<string, { siteGroupId: string; simulationDesired: boolean }>;

let listener: ReturnType<typeof setInterval> | null = null;
let previousSnapshot: DeviceSnapshot = new Map();

async function pollLifecycleChanges(): Promise<void> {
  const devices = await prisma.device.findMany({
    select: {
      deviceKey: true,
      siteGroupId: true,
      simulationDesired: true,
    },
  });

  const nextSnapshot: DeviceSnapshot = new Map();
  const affectedSiteGroups = new Set<string>();

  for (const device of devices) {
    const next = {
      siteGroupId: device.siteGroupId,
      simulationDesired: device.simulationDesired,
    };
    nextSnapshot.set(device.deviceKey, next);

    const prev = previousSnapshot.get(device.deviceKey);
    if (!prev) continue;

    if (prev.simulationDesired && !next.simulationDesired) {
      affectedSiteGroups.add(next.siteGroupId);
      continue;
    }

    if (!prev.simulationDesired && next.simulationDesired) {
      affectedSiteGroups.add(next.siteGroupId);
    }
  }

  previousSnapshot = nextSnapshot;

  for (const siteGroupId of affectedSiteGroups) {
    await reconcileSiteGroup(siteGroupId);
  }
}

export function startLifecycleListener({ pollIntervalMs = 5000 }: { pollIntervalMs?: number } = {}): void {
  if (listener) return;
  void pollLifecycleChanges();
  listener = setInterval(() => {
    void pollLifecycleChanges();
  }, pollIntervalMs);
}

export function stopLifecycleListener(): void {
  if (!listener) return;
  clearInterval(listener);
  listener = null;
  previousSnapshot = new Map();
}

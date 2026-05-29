import { DeviceRegistrationState, PrismaClient } from '@prisma/client';
import prisma from '../src/client';

type ScriptOptions = { siteGroupId: string; dryRun: boolean };
type SensorLike = { id?: string; intervalMs?: number; min?: number; max?: number; unit?: string; type?: string };

const STM32_HEX_24 = /^[0-9A-F]{24}$/;

export function parseArgs(argv: string[]): ScriptOptions {
  const siteGroupFlag = argv.findIndex((arg) => arg === '--site-group');
  if (siteGroupFlag === -1 || !argv[siteGroupFlag + 1]) {
    throw new Error('--site-group <id> is required');
  }
  return { siteGroupId: argv[siteGroupFlag + 1], dryRun: argv.includes('--dry') };
}

export async function migrateSensorsToDevices(db: PrismaClient, options: ScriptOptions): Promise<{ skipped: number }> {
  const gateways = await db.gateway.findMany({ where: { siteGroupId: options.siteGroupId } });
  let skipped = 0;

  for (const gateway of gateways) {
    if (gateway.deviceKey) {
      skipped += 1;
      continue;
    }

    const sensorList = Array.isArray(gateway.sensors) ? (gateway.sensors as unknown as SensorLike[]) : [];
    const isRegistered = Boolean(gateway.rootCaPemEnc) && STM32_HEX_24.test(gateway.clientId);
    const registrationState = isRegistered ? DeviceRegistrationState.REGISTERED : DeviceRegistrationState.UNREGISTERED;

    if (options.dryRun) continue;

    await db.$transaction(async (tx) => {
      const gatewayDevice = await tx.device.create({
        data: {
          siteGroupId: gateway.siteGroupId,
          canvasNodeId: `migrated-gateway-${gateway.id}`,
          deviceTypeId: gateway.kind.toLowerCase().includes('daejak') ? 'daejak-main-v1' : 'core-generic-gateway',
          shadowUuid: gateway.clientId,
          registrationState,
          realUuid: isRegistered ? gateway.clientId : null,
          simulationDesired: true,
        },
      });

      await tx.gateway.update({ where: { id: gateway.id }, data: { deviceKey: gatewayDevice.deviceKey } });

      for (const sensor of sensorList) {
        await tx.device.create({
          data: {
            siteGroupId: gateway.siteGroupId,
            canvasNodeId: `migrated-sensor-${gateway.id}-${sensor.id ?? crypto.randomUUID()}`,
            parentDeviceKey: gatewayDevice.deviceKey,
            deviceTypeId: 'core-generic-sensor',
            shadowUuid: sensor.id ?? crypto.randomUUID(),
            config: {
              signal: {
                rateMs: sensor.intervalMs ?? 1000,
                range: { min: sensor.min ?? 0, max: sensor.max ?? 100 },
                format: sensor.unit ?? sensor.type ?? 'number',
              },
            },
            simulationDesired: true,
          },
        });
      }

      const siteGroup = await tx.siteGroup.findUniqueOrThrow({
        where: { id: gateway.siteGroupId },
        select: { project: { select: { orgId: true } } },
      });

      await tx.auditLog.create({
        data: {
          orgId: siteGroup.project.orgId,
          action: 'device.migrated',
          targetId: gateway.id,
          targetType: 'gateway',
          metadata: { gatewayId: gateway.id, deviceKey: gatewayDevice.deviceKey, sensorCount: sensorList.length },
        },
      });
    });
  }

  return { skipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  parseArgs(process.argv.slice(2));
  migrateSensorsToDevices(prisma, parseArgs(process.argv.slice(2)))
    .then(({ skipped }) => process.exit(skipped > 0 ? 1 : 0))
    .catch(() => process.exit(2));
}

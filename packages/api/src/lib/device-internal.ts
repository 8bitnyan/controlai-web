import { TRPCError } from '@trpc/server';
import { assertKnownDeviceType } from '@controlai-web/shared-types';
import type { Device, PrismaClient, Prisma } from '@controlai-web/db';
import { writeAudit } from './audit-writer';

type CreateDeviceInternalArgs = {
  orgId: string;
  userId?: string | null;
  siteGroupId: string;
  canvasNodeId: string;
  deviceTypeId: string;
  parentDeviceKey?: string | null;
  config?: Prisma.InputJsonValue;
  portBindings?: Prisma.InputJsonValue;
  shadowUuid?: string | null;
  simulationDesired?: boolean;
};

export async function createDeviceInternal(
  args: CreateDeviceInternalArgs,
  db: PrismaClient,
): Promise<Device> {
  try {
    assertKnownDeviceType(args.deviceTypeId);
  } catch {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Unknown device-type: ${args.deviceTypeId}` });
  }

  if (args.parentDeviceKey) {
    const parent = await db.device.findUnique({ where: { deviceKey: args.parentDeviceKey } });
    if (!parent || parent.siteGroupId !== args.siteGroupId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'parentDeviceKey must be in same siteGroup' });
    }
  }

  const existing = await db.device.findUnique({
    where: {
      siteGroupId_canvasNodeId: {
        siteGroupId: args.siteGroupId,
        canvasNodeId: args.canvasNodeId,
      },
    },
  });
  if (existing) {
    throw new TRPCError({ code: 'CONFLICT', message: 'canvasNodeId already exists in siteGroup' });
  }

  const row = await db.device.create({
    data: {
      siteGroupId: args.siteGroupId,
      canvasNodeId: args.canvasNodeId,
      deviceTypeId: args.deviceTypeId,
      parentDeviceKey: args.parentDeviceKey ?? null,
      config: (args.config ?? {}) as Prisma.InputJsonValue,
      portBindings: args.portBindings,
      shadowUuid: args.shadowUuid ?? crypto.randomUUID(),
      simulationDesired: args.simulationDesired ?? true,
      registrationState: 'UNREGISTERED',
    },
  });

  void writeAudit(db, {
    orgId: args.orgId,
    userId: args.userId,
    action: 'device.create',
    targetId: row.deviceKey,
    targetType: 'Device',
  });

  return row;
}

export async function deleteDeviceInternal(args: {
  deviceKey: string;
  db: PrismaClient;
  orgId: string;
  userId?: string | null;
}): Promise<void> {
  const row = await args.db.device.findUnique({ where: { deviceKey: args.deviceKey } });
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Device not found' });

  if (row.registrationState === 'UNREGISTERED') {
    await args.db.device.delete({ where: { deviceKey: args.deviceKey } });
    void writeAudit(args.db, {
      orgId: args.orgId,
      userId: args.userId,
      action: 'device.delete-hard',
      targetId: args.deviceKey,
      targetType: 'Device',
    });
    return;
  }

  await args.db.device.update({
    where: { deviceKey: args.deviceKey },
    data: { registrationState: 'ORPHANED' },
  });
  void writeAudit(args.db, {
    orgId: args.orgId,
    userId: args.userId,
    action: 'device.soft-archive',
    targetId: args.deviceKey,
    targetType: 'Device',
  });
}

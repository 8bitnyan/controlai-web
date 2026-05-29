import { describe, expect, it, vi } from 'vitest';
import { DeviceRegistrationState } from '@prisma/client';
import { migrateSensorsToDevices } from '../migrate-sensors-to-devices';

function makeDb(gateway: { clientId: string; rootCaPemEnc: string; sensors: unknown[]; deviceKey: string | null }) {
  const deviceCreate = vi
    .fn()
    .mockResolvedValueOnce({ deviceKey: 'dev-gateway-key' })
    .mockResolvedValue({ deviceKey: 'dev-sensor-key' });
  const tx = {
    device: { create: deviceCreate },
    gateway: { update: vi.fn() },
    siteGroup: { findUniqueOrThrow: vi.fn().mockResolvedValue({ project: { orgId: 'org-1' } }) },
    auditLog: { create: vi.fn() },
  };
  const db = {
    gateway: { findMany: vi.fn().mockResolvedValue([{ id: 'gw-1', siteGroupId: 'sg-1', kind: 'physical', ...gateway }]) },
    $transaction: vi.fn(async (fn: (txArg: typeof tx) => Promise<void>) => fn(tx)),
  };
  return { db, tx, deviceCreate };
}

describe('migrate-sensors-to-devices', () => {
  it('creates 4 devices from a 3-sensor gateway', async () => {
    const { db, deviceCreate } = makeDb({
      clientId: 'client-1',
      rootCaPemEnc: 'pem',
      sensors: [{ id: 's1' }, { id: 's2' }, { id: 's3' }],
      deviceKey: null,
    });
    await migrateSensorsToDevices(db as never, { siteGroupId: 'sg-1', dryRun: false });
    expect(deviceCreate).toHaveBeenCalledTimes(4);
  });

  it('is idempotent when gateway.deviceKey already exists', async () => {
    const { db, deviceCreate } = makeDb({ clientId: 'client-1', rootCaPemEnc: 'pem', sensors: [{ id: 's1' }], deviceKey: 'k1' });
    const result = await migrateSensorsToDevices(db as never, { siteGroupId: 'sg-1', dryRun: false });
    expect(result.skipped).toBe(1);
    expect(deviceCreate).not.toHaveBeenCalled();
  });

  it('marks STM32 24-hex clientId as REGISTERED with realUuid', async () => {
    const { db, deviceCreate } = makeDb({ clientId: 'ABCDEF123456ABCDEF123456', rootCaPemEnc: 'pem', sensors: [], deviceKey: null });
    await migrateSensorsToDevices(db as never, { siteGroupId: 'sg-1', dryRun: false });
    expect(deviceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          registrationState: DeviceRegistrationState.REGISTERED,
          realUuid: 'ABCDEF123456ABCDEF123456',
        }),
      }),
    );
  });

  it('keeps gateway UNREGISTERED when PEM is missing', async () => {
    const { db, deviceCreate } = makeDb({ clientId: 'ABCDEF123456ABCDEF123456', rootCaPemEnc: '', sensors: [], deviceKey: null });
    await migrateSensorsToDevices(db as never, { siteGroupId: 'sg-1', dryRun: false });
    expect(deviceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          registrationState: DeviceRegistrationState.UNREGISTERED,
          realUuid: null,
        }),
      }),
    );
  });
});

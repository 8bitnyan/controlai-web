import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { findManyNodeConfigMock, findManyDeviceMock, writeAuditMock } = vi.hoisted(() => ({
  findManyNodeConfigMock: vi.fn(),
  findManyDeviceMock: vi.fn(),
  writeAuditMock: vi.fn(),
}));

vi.mock('@controlai-web/db', () => ({
  prisma: {
    nodeConfig: { findMany: findManyNodeConfigMock },
    device: { findMany: findManyDeviceMock },
  },
}));

vi.mock('../../lib/audit-writer', () => ({
  writeAudit: writeAuditMock,
}));

import { startDeviceCanvasReconcileJob } from '../device-canvas-reconcile';

describe('startDeviceCanvasReconcileJob', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.ENABLE_DEVICE_RECONCILE = 'true';
    findManyNodeConfigMock.mockReset();
    findManyDeviceMock.mockReset();
    writeAuditMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.ENABLE_DEVICE_RECONCILE;
  });

  it('returns no audit when canvas and devices align', async () => {
    findManyNodeConfigMock.mockResolvedValue([
      {
        id: 'sg-1',
        projectId: 'p-1',
        nodes: [{ id: 'n1' }, { id: 'n2' }],
        siteGroup: { project: { orgId: 'org-1' } },
      },
    ]);
    findManyDeviceMock.mockResolvedValue([{ canvasNodeId: 'n1' }, { canvasNodeId: 'n2' }]);

    startDeviceCanvasReconcileJob({ intervalMs: 1000 });
    await vi.runOnlyPendingTimersAsync();

    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it('audits canvas-missing-device mismatches', async () => {
    findManyNodeConfigMock.mockResolvedValue([
      {
        id: 'sg-1',
        projectId: 'p-1',
        nodes: [{ id: 'n1' }, { id: 'n2' }],
        siteGroup: { project: { orgId: 'org-1' } },
      },
    ]);
    findManyDeviceMock.mockResolvedValue([{ canvasNodeId: 'n1' }]);

    startDeviceCanvasReconcileJob({ intervalMs: 1000 });
    await vi.runOnlyPendingTimersAsync();

    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'device.reconcile-mismatch',
        metadata: expect.objectContaining({
          kind: 'canvas-missing-device',
          count: 1,
          ids: ['n2'],
        }),
      }),
    );
  });

  it('audits device-missing-canvas mismatches', async () => {
    findManyNodeConfigMock.mockResolvedValue([
      {
        id: 'sg-1',
        projectId: 'p-1',
        nodes: [{ id: 'n1' }],
        siteGroup: { project: { orgId: 'org-1' } },
      },
    ]);
    findManyDeviceMock.mockResolvedValue([{ canvasNodeId: 'n1' }, { canvasNodeId: 'n9' }]);

    startDeviceCanvasReconcileJob({ intervalMs: 1000 });
    await vi.runOnlyPendingTimersAsync();

    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'device.reconcile-mismatch',
        metadata: expect.objectContaining({
          kind: 'device-missing-canvas',
          count: 1,
          ids: ['n9'],
        }),
      }),
    );
  });

  it('excludes ORPHANED devices from mismatch check', async () => {
    findManyNodeConfigMock.mockResolvedValue([
      {
        id: 'sg-1',
        projectId: 'p-1',
        nodes: [{ id: 'n1' }],
        siteGroup: { project: { orgId: 'org-1' } },
      },
    ]);
    findManyDeviceMock.mockResolvedValue([{ canvasNodeId: 'n1' }]);

    startDeviceCanvasReconcileJob({ intervalMs: 1000 });
    await vi.runOnlyPendingTimersAsync();

    expect(findManyDeviceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ registrationState: { not: 'ORPHANED' } }),
      }),
    );
  });

  it('cleanup function clears interval', () => {
    findManyNodeConfigMock.mockResolvedValue([]);
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');

    const cleanup = startDeviceCanvasReconcileJob({ intervalMs: 1000 });
    cleanup?.();

    expect(clearSpy).toHaveBeenCalled();
  });
});

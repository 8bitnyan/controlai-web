import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findManyMock, reconcileSiteGroupMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  reconcileSiteGroupMock: vi.fn(),
}));

vi.mock('@controlai-web/db', () => ({
  prisma: {
    device: {
      findMany: findManyMock,
    },
  },
}));

vi.mock('../manager.js', () => ({
  reconcileSiteGroup: reconcileSiteGroupMock,
}));

import { startLifecycleListener, stopLifecycleListener } from '../lifecycle-listener.js';

describe('lifecycle listener', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    stopLifecycleListener();
  });

  it('snapshots current devices on initial start', async () => {
    findManyMock.mockResolvedValueOnce([
      { deviceKey: 'd1', siteGroupId: 'sg-1', simulationDesired: true },
    ]);

    startLifecycleListener({ pollIntervalMs: 5000 });
    await vi.advanceTimersByTimeAsync(0);

    expect(findManyMock).toHaveBeenCalledTimes(1);
    expect(reconcileSiteGroupMock).not.toHaveBeenCalled();
  });

  it('calls reconcileSiteGroup when simulationDesired flips true to false', async () => {
    findManyMock
      .mockResolvedValueOnce([{ deviceKey: 'd1', siteGroupId: 'sg-1', simulationDesired: true }])
      .mockResolvedValueOnce([{ deviceKey: 'd1', siteGroupId: 'sg-1', simulationDesired: false }]);

    startLifecycleListener({ pollIntervalMs: 5000 });
    await vi.advanceTimersByTimeAsync(5000);

    expect(reconcileSiteGroupMock).toHaveBeenCalledTimes(1);
    expect(reconcileSiteGroupMock).toHaveBeenCalledWith('sg-1');
  });

  it('does not call reconcileSiteGroup when simulationDesired remains true', async () => {
    findManyMock
      .mockResolvedValueOnce([{ deviceKey: 'd1', siteGroupId: 'sg-1', simulationDesired: true }])
      .mockResolvedValueOnce([{ deviceKey: 'd1', siteGroupId: 'sg-1', simulationDesired: true }]);

    startLifecycleListener({ pollIntervalMs: 5000 });
    await vi.advanceTimersByTimeAsync(5000);

    expect(reconcileSiteGroupMock).not.toHaveBeenCalled();
  });

  it('stopLifecycleListener cleans up interval', async () => {
    findManyMock.mockResolvedValue([]);

    startLifecycleListener({ pollIntervalMs: 5000 });
    await vi.advanceTimersByTimeAsync(0);
    stopLifecycleListener();
    await vi.advanceTimersByTimeAsync(15000);

    expect(findManyMock).toHaveBeenCalledTimes(1);
  });
});

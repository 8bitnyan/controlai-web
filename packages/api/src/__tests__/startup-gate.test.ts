import { beforeEach, describe, expect, it, vi } from 'vitest';

const { countMock } = vi.hoisted(() => ({
  countMock: vi.fn(),
}));

vi.mock('@controlai-web/db', () => ({
  prisma: {
    gateway: {
      count: countMock,
    },
  },
}));

import { enforceGatewayDeviceKeyStartupGate } from '../lib/startup-gate';

describe('enforceGatewayDeviceKeyStartupGate', () => {
  beforeEach(() => {
    countMock.mockReset();
  });

  it('does nothing when no null deviceKey rows exist', async () => {
    countMock.mockResolvedValue(0);
    const logger = { warn: vi.fn(), error: vi.fn() };
    const exit = vi.fn(() => {
      throw new Error('should-not-exit');
    });

    await enforceGatewayDeviceKeyStartupGate('production', logger, exit);

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it('warns and continues outside production', async () => {
    countMock.mockResolvedValue(3);
    const logger = { warn: vi.fn(), error: vi.fn() };
    const exit = vi.fn(() => {
      throw new Error('should-not-exit');
    });

    await enforceGatewayDeviceKeyStartupGate('development', logger, exit);

    expect(logger.warn).toHaveBeenCalledWith(
      '[startup-gate] 3 Gateway rows have null deviceKey — run pnpm --filter @controlai-web/db db:migrate-devices --site-group <id>',
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it('logs fatal and exits in production', async () => {
    countMock.mockResolvedValue(2);
    const logger = { warn: vi.fn(), error: vi.fn() };
    const exit = vi.fn(() => {
      throw new Error('exit-called');
    });

    await expect(enforceGatewayDeviceKeyStartupGate('production', logger, exit)).rejects.toThrow('exit-called');

    expect(logger.error).toHaveBeenCalledWith(
      '[startup-gate] 2 Gateway rows have null deviceKey — run pnpm --filter @controlai-web/db db:migrate-devices --site-group <id>',
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});

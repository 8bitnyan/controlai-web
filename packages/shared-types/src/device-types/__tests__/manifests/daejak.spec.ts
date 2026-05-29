import { beforeEach, describe, expect, it, vi } from 'vitest';

const cases = [
  { id: 'daejak-main-v1', category: 'gateway', firmwareTypeIds: ['DAEJAK_MAIN_V1'], modulePath: '../../manifests/daejak/daejak-main-v1' },
  { id: 'daejak-vm', category: 'sensor', firmwareTypeIds: ['DAEJAK_VM'], modulePath: '../../manifests/daejak/daejak-vm' },
] as const;

describe('daejak manifests', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it.each(cases)('registers $id', async ({ id, category, firmwareTypeIds, modulePath }) => {
    const registry = await import('../../registry');
    registry.__resetRegistryForTests();
    await import(modulePath);
    const manifest = registry.getDeviceType(id);
    expect(manifest).toBeDefined();
    expect(manifest?.category).toBe(category);
    expect(manifest?.firmwareTypeIds).toEqual(firmwareTypeIds);
    expect(manifest).toMatchSnapshot();
  });
});

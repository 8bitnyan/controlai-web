import { beforeEach, describe, expect, it, vi } from 'vitest';

const cases = [
  { id: 'core-generic-sensor', category: 'sensor', modulePath: '../../manifests/core/generic-sensor' },
  { id: 'core-generic-gateway', category: 'gateway', modulePath: '../../manifests/core/generic-gateway' },
  { id: 'core-generic-broker', category: 'broker', modulePath: '../../manifests/core/generic-broker' },
  { id: 'core-generic-ingest', category: 'ingest', modulePath: '../../manifests/core/generic-ingest' },
  { id: 'core-generic-tsdb', category: 'tsdb', modulePath: '../../manifests/core/generic-tsdb' },
  { id: 'core-generic-monitoring', category: 'monitoring', modulePath: '../../manifests/core/generic-monitoring' },
] as const;

describe('core manifests', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it.each(cases)('registers $id', async ({ id, category, modulePath }) => {
    const registry = await import('../../registry');
    registry.__resetRegistryForTests();
    await import(modulePath);
    const manifest = registry.getDeviceType(id);
    expect(manifest).toBeDefined();
    expect(manifest?.category).toBe(category);
    expect(manifest).toMatchSnapshot();
  });
});

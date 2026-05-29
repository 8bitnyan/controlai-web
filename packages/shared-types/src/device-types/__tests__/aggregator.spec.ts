import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const packageRoot = process.cwd();
const deviceTypesRoot = join(packageRoot, 'src/device-types');
const manifestsRoot = join(deviceTypesRoot, 'manifests');
const aggregatorPath = join(deviceTypesRoot, 'index.ts');

function discoverManifestFiles(): string[] {
  const entries = readdirSync(manifestsRoot, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(manifestsRoot, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .filter((relativePath) => relativePath.endsWith('.ts') && !relativePath.includes('__tests__'))
    .sort();
}

describe('device-types aggregator contract', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('imports every manifest file and registers all manifests', async () => {
    const manifestFiles = discoverManifestFiles();
    const aggregatorSource = readFileSync(aggregatorPath, 'utf8');

    for (const relativeManifestPath of manifestFiles) {
      const importPath = relativeManifestPath.replace(/\.ts$/, '');
      const pattern = new RegExp(`import './manifests/${importPath}';`);
      expect(aggregatorSource).toMatch(pattern);
    }

    const registry = await import('../registry');
    registry.__resetRegistryForTests();
    await import('../index');

    expect(registry.listDeviceTypes()).toHaveLength(manifestFiles.length);
  });
});

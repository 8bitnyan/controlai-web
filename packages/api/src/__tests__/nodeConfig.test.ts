import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { assertKnownDeviceType, LEGACY_TYPE_MAP } from '@controlai-web/shared-types';

/**
 * Unit tests for nodeConfig router logic.
 *
 * The router uses Prisma, so we mock the db layer and simulate the router
 * procedures directly to verify:
 *   - save creates a new version when the latest is active or no config exists
 *   - save updates in-place when the latest draft exists
 *   - setActive clears all previous active flags
 *   - load returns null when no config exists for a siteGroup
 */

// ─── Helper: build a minimal mock Prisma for nodeConfig ──────────────────────

function makeNodeConfigPrisma(overrides: {
  siteGroupFindFirst?: unknown;
  nodeConfigFindFirst?: unknown;
  nodeConfigFindMany?: unknown;
  nodeConfigCreate?: unknown;
  nodeConfigUpdate?: unknown;
  nodeConfigUpdateMany?: unknown;
  deviceFindUnique?: unknown;
  deviceCreate?: unknown;
  deviceDelete?: unknown;
  deviceUpdate?: unknown;
} = {}) {
  return {
    siteGroup: {
      findFirst: vi.fn().mockResolvedValue(
        overrides.siteGroupFindFirst !== undefined
          ? overrides.siteGroupFindFirst
          : { id: 'sg-1', project: { orgId: 'org-1' } },
      ),
    },
    nodeConfig: {
      findFirst: vi.fn().mockResolvedValue(overrides.nodeConfigFindFirst ?? null),
      findMany: vi.fn().mockResolvedValue(overrides.nodeConfigFindMany ?? []),
      create: vi.fn().mockResolvedValue(overrides.nodeConfigCreate ?? { id: 'nc-new', version: 1, isActive: false }),
      update: vi.fn().mockResolvedValue(overrides.nodeConfigUpdate ?? { id: 'nc-1', version: 1, isActive: false }),
      updateMany: vi.fn().mockResolvedValue(overrides.nodeConfigUpdateMany ?? { count: 1 }),
    },
    device: {
      findUnique: vi.fn().mockResolvedValue(overrides.deviceFindUnique ?? null),
      create: vi.fn().mockResolvedValue(overrides.deviceCreate ?? { deviceKey: 'dev-1' }),
      delete: vi.fn().mockResolvedValue(overrides.deviceDelete ?? { deviceKey: 'dev-1' }),
      update: vi.fn().mockResolvedValue(overrides.deviceUpdate ?? { deviceKey: 'dev-1' }),
    },
  };
}

// ─── Simulated router logic (mirroring nodeConfig.ts) ────────────────────────

async function simulateSave(
  prisma: ReturnType<typeof makeNodeConfigPrisma>,
  input: { siteGroupId: string; orgId: string; nodes: unknown[]; edges: unknown[] },
) {
  const sg = await prisma.siteGroup.findFirst({ where: {} });
  if (!sg) throw new TRPCError({ code: 'FORBIDDEN' });

  const latest = await prisma.nodeConfig.findFirst({ where: {} });

  for (const node of input.nodes) {
    const parsedNode = z
      .object({
        data: z.object({ deviceTypeId: z.string().optional() }).optional(),
      })
      .passthrough()
      .parse(node);
    const deviceTypeId = parsedNode.data?.deviceTypeId;
    if (!deviceTypeId) continue;
    try {
      assertKnownDeviceType(deviceTypeId);
    } catch {
      throw new TRPCError({ code: 'BAD_REQUEST', message: `Unknown device-type: ${deviceTypeId}` });
    }
  }

  if (!latest || (latest as { isActive?: boolean }).isActive) {
    const nextVersion = latest ? (latest as { version: number }).version + 1 : 1;
    const persisted = await prisma.nodeConfig.create({
      data: {
        siteGroupId: input.siteGroupId,
        version: nextVersion,
        nodes: input.nodes as unknown[],
        edges: input.edges as unknown[],
        isActive: false,
      },
    });

    const previousNodes = latest ? (((latest as { nodes?: unknown[] }).nodes as unknown[]) ?? []) : [];
    const prevIds = new Set(previousNodes.map((n) => (n as { id: string }).id));
    const newIds = new Set(input.nodes.map((n) => (n as { id: string }).id));
    const added = input.nodes.filter((n) => !prevIds.has((n as { id: string }).id));
    const removed = previousNodes.filter((n) => !newIds.has((n as { id: string }).id));

    for (const node of added) {
      const parsedNode = node as { id: string; data?: { deviceTypeId?: string; config?: unknown } };
      await prisma.device.create({
        data: {
          siteGroupId: input.siteGroupId,
          canvasNodeId: parsedNode.id,
          deviceTypeId: parsedNode.data?.deviceTypeId ?? 'core-generic-sensor',
          config: parsedNode.data?.config ?? {},
          simulationDesired: true,
          registrationState: 'UNREGISTERED',
        },
      });
    }

    for (const node of removed) {
      const found = await prisma.device.findUnique({
        where: {
          siteGroupId_canvasNodeId: {
            siteGroupId: input.siteGroupId,
            canvasNodeId: (node as { id: string }).id,
          },
        },
      });
      if (!found) continue;
      const device = found as { deviceKey: string; registrationState: string };
      if (device.registrationState === 'UNREGISTERED') {
        await prisma.device.delete({ where: { deviceKey: device.deviceKey } });
      } else {
        await prisma.device.update({ where: { deviceKey: device.deviceKey }, data: { registrationState: 'ORPHANED' } });
      }
    }

    return persisted;
  }

  const persisted = await prisma.nodeConfig.update({
    where: { id: (latest as { id: string }).id },
    data: { nodes: input.nodes as unknown[], edges: input.edges as unknown[], updatedAt: new Date() },
  });

  const previousNodes = (((latest as { nodes?: unknown[] }).nodes as unknown[]) ?? []) as Array<{ id: string }>;
  const prevIds = new Set(previousNodes.map((n) => n.id));
  const newIds = new Set(input.nodes.map((n) => (n as { id: string }).id));
  const added = input.nodes.filter((n) => !prevIds.has((n as { id: string }).id));
  const removed = previousNodes.filter((n) => !newIds.has(n.id));

  for (const node of added) {
    const parsedNode = node as { id: string; data?: { deviceTypeId?: string; config?: unknown } };
    await prisma.device.create({
      data: {
        siteGroupId: input.siteGroupId,
        canvasNodeId: parsedNode.id,
        deviceTypeId: parsedNode.data?.deviceTypeId ?? 'core-generic-sensor',
        config: parsedNode.data?.config ?? {},
        simulationDesired: true,
        registrationState: 'UNREGISTERED',
      },
    });
  }

  for (const node of removed) {
    const found = await prisma.device.findUnique({
      where: {
        siteGroupId_canvasNodeId: {
          siteGroupId: input.siteGroupId,
          canvasNodeId: node.id,
        },
      },
    });
    if (!found) continue;
    const device = found as { deviceKey: string; registrationState: string };
    if (device.registrationState === 'UNREGISTERED') {
      await prisma.device.delete({ where: { deviceKey: device.deviceKey } });
    } else {
      await prisma.device.update({ where: { deviceKey: device.deviceKey }, data: { registrationState: 'ORPHANED' } });
    }
  }

  return persisted;
}

async function simulateSetActive(
  prisma: ReturnType<typeof makeNodeConfigPrisma>,
  input: { nodeConfigId: string; orgId: string; appliedHash?: string },
  nc: { id: string; siteGroupId: string; siteGroup: { project: { orgId: string } } },
) {
  if (nc.siteGroup.project.orgId !== input.orgId) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }

  await prisma.nodeConfig.updateMany({
    where: { siteGroupId: nc.siteGroupId, isActive: true },
    data: { isActive: false },
  });

  return prisma.nodeConfig.update({
    where: { id: input.nodeConfigId },
    data: { isActive: true, appliedAt: new Date(), appliedHash: input.appliedHash ?? null },
  });
}

async function simulateLoad(
  prisma: ReturnType<typeof makeNodeConfigPrisma>,
  _input: { siteGroupId: string; orgId: string },
) {
  const sg = await prisma.siteGroup.findFirst({ where: {} });
  if (!sg) throw new TRPCError({ code: 'FORBIDDEN' });

  const active = await prisma.nodeConfig.findFirst({ where: {} });
  if (active) {
    const parsedActive = z.object({ nodes: z.array(z.unknown()).optional() }).passthrough().parse(active);
    const nodes = (parsedActive.nodes ?? []).map((node) => {
      const parsedNode = z
        .object({
          type: z.string().optional(),
          data: z.record(z.string(), z.unknown()).optional(),
        })
        .passthrough()
        .parse(node);
      if (parsedNode.data?.deviceTypeId) return node;
      if (!parsedNode.type || !(parsedNode.type in LEGACY_TYPE_MAP)) return node;
      return {
        ...parsedNode,
        data: {
          ...(parsedNode.data ?? {}),
          deviceTypeId: LEGACY_TYPE_MAP[parsedNode.type as keyof typeof LEGACY_TYPE_MAP],
        },
      };
    });
    return { ...active, nodes };
  }
  return null;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('nodeConfig router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('load', () => {
    it('returns null when no config exists for the siteGroup', async () => {
      const prisma = makeNodeConfigPrisma({ nodeConfigFindFirst: null });
      const result = await simulateLoad(prisma, { siteGroupId: 'sg-1', orgId: 'org-1' });
      expect(result).toBeNull();
    });

    it('returns the active config when one exists', async () => {
      const activeConfig = { id: 'nc-1', version: 2, isActive: true, nodes: [], edges: [] };
      const prisma = makeNodeConfigPrisma({ nodeConfigFindFirst: activeConfig });
      const result = await simulateLoad(prisma, { siteGroupId: 'sg-1', orgId: 'org-1' });
      expect(result).toEqual(activeConfig);
    });

    it('throws FORBIDDEN when siteGroup not found / not in org', async () => {
      const prisma = makeNodeConfigPrisma({ siteGroupFindFirst: null });
      await expect(
        simulateLoad(prisma, { siteGroupId: 'sg-x', orgId: 'org-1' }),
      ).rejects.toThrow(TRPCError);
    });

    it('augments legacy node types with mapped deviceTypeId in memory', async () => {
      const legacyCases = [
        ['sensor', 'core-generic-sensor'],
        ['gateway', 'core-generic-gateway'],
        ['broker', 'core-generic-broker'],
        ['ingest', 'core-generic-ingest'],
        ['timescaledb', 'core-generic-tsdb'],
        ['monitoring', 'core-generic-monitoring'],
      ] as const;

      for (const [legacyType, expectedId] of legacyCases) {
        const activeConfig = {
          id: 'nc-1',
          version: 2,
          isActive: true,
          nodes: [{ id: 'n1', type: legacyType, data: {} }],
          edges: [],
        };
        const prisma = makeNodeConfigPrisma({ nodeConfigFindFirst: activeConfig });
        const result = await simulateLoad(prisma, { siteGroupId: 'sg-1', orgId: 'org-1' });
        expect((result as { nodes: Array<{ data: { deviceTypeId?: string } }> }).nodes[0]?.data.deviceTypeId).toBe(
          expectedId,
        );
        expect(prisma.nodeConfig.update).not.toHaveBeenCalled();
      }
    });

    it('leaves nodes with existing known deviceTypeId untouched', async () => {
      const activeConfig = {
        id: 'nc-1',
        version: 2,
        isActive: true,
        nodes: [{ id: 'n1', type: 'sensor', data: { deviceTypeId: 'core-generic-sensor' } }],
        edges: [],
      };
      const prisma = makeNodeConfigPrisma({ nodeConfigFindFirst: activeConfig });
      const result = await simulateLoad(prisma, { siteGroupId: 'sg-1', orgId: 'org-1' });
      expect((result as { nodes: Array<{ data: { deviceTypeId?: string } }> }).nodes[0]?.data.deviceTypeId).toBe(
        'core-generic-sensor',
      );
    });
  });

  describe('save', () => {
    it('creates a new version (v1) when no config exists', async () => {
      const prisma = makeNodeConfigPrisma({
        nodeConfigFindFirst: null,
        nodeConfigCreate: { id: 'nc-new', version: 1, isActive: false },
      });

      await simulateSave(prisma, {
        siteGroupId: 'sg-1',
        orgId: 'org-1',
        nodes: [],
        edges: [],
      });

      expect(prisma.nodeConfig.create).toHaveBeenCalledOnce();
      const callArg = vi.mocked(prisma.nodeConfig.create).mock.calls[0]![0] as { data: { version: number } };
      expect(callArg.data.version).toBe(1);
    });

    it('increments version when latest config is active', async () => {
      const prisma = makeNodeConfigPrisma({
        nodeConfigFindFirst: { id: 'nc-1', version: 3, isActive: true },
        nodeConfigCreate: { id: 'nc-new', version: 4, isActive: false },
      });

      await simulateSave(prisma, {
        siteGroupId: 'sg-1',
        orgId: 'org-1',
        nodes: [{ id: 'n1' }],
        edges: [],
      });

      expect(prisma.nodeConfig.create).toHaveBeenCalledOnce();
      const callArg = vi.mocked(prisma.nodeConfig.create).mock.calls[0]![0] as { data: { version: number } };
      expect(callArg.data.version).toBe(4); // 3 + 1
    });

    it('updates in-place when the latest config is a draft (not active)', async () => {
      const prisma = makeNodeConfigPrisma({
        nodeConfigFindFirst: { id: 'nc-draft', version: 2, isActive: false },
      });

      await simulateSave(prisma, {
        siteGroupId: 'sg-1',
        orgId: 'org-1',
        nodes: [{ id: 'n1' }],
        edges: [{ id: 'e1' }],
      });

      expect(prisma.nodeConfig.update).toHaveBeenCalledOnce();
      expect(prisma.nodeConfig.create).not.toHaveBeenCalled();
    });

    it('rejects unknown deviceTypeId with BAD_REQUEST and id in message', async () => {
      const prisma = makeNodeConfigPrisma({ nodeConfigFindFirst: null });
      await expect(
        simulateSave(prisma, {
          siteGroupId: 'sg-1',
          orgId: 'org-1',
          nodes: [{ id: 'n1', data: { deviceTypeId: 'unknown-id' } }],
          edges: [],
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('unknown-id') });
    });

    it('accepts known deviceTypeId', async () => {
      const prisma = makeNodeConfigPrisma({ nodeConfigFindFirst: null });
      await expect(
        simulateSave(prisma, {
          siteGroupId: 'sg-1',
          orgId: 'org-1',
          nodes: [{ id: 'n1', data: { deviceTypeId: 'core-generic-sensor' } }],
          edges: [],
        }),
      ).resolves.toBeDefined();
      expect(prisma.nodeConfig.create).toHaveBeenCalledOnce();
    });

    it('creates device rows for added nodes', async () => {
      const prisma = makeNodeConfigPrisma({ nodeConfigFindFirst: { id: 'nc-1', version: 1, isActive: false, nodes: [] } });
      await simulateSave(prisma, {
        siteGroupId: 'sg-1',
        orgId: 'org-1',
        nodes: [{ id: 'n1', data: { deviceTypeId: 'core-generic-sensor' } }],
        edges: [],
      });
      expect(prisma.device.create).toHaveBeenCalledOnce();
      const arg = vi.mocked(prisma.device.create).mock.calls[0]![0] as { data: { deviceTypeId: string; canvasNodeId: string } };
      expect(arg.data.deviceTypeId).toBe('core-generic-sensor');
      expect(arg.data.canvasNodeId).toBe('n1');
    });

    it('soft-deletes removed registered devices', async () => {
      const prisma = makeNodeConfigPrisma({
        nodeConfigFindFirst: { id: 'nc-1', version: 1, isActive: false, nodes: [{ id: 'n1' }] },
      });
      vi.mocked(prisma.device.findUnique).mockResolvedValue({ deviceKey: 'dev-1', registrationState: 'REGISTERED' });
      await simulateSave(prisma, { siteGroupId: 'sg-1', orgId: 'org-1', nodes: [], edges: [] });
      expect(prisma.device.update).toHaveBeenCalledOnce();
      expect(prisma.device.delete).not.toHaveBeenCalled();
    });

    it('hard-deletes removed unregistered devices', async () => {
      const prisma = makeNodeConfigPrisma({
        nodeConfigFindFirst: { id: 'nc-1', version: 1, isActive: false, nodes: [{ id: 'n1' }] },
      });
      vi.mocked(prisma.device.findUnique).mockResolvedValue({ deviceKey: 'dev-1', registrationState: 'UNREGISTERED' });
      await simulateSave(prisma, { siteGroupId: 'sg-1', orgId: 'org-1', nodes: [], edges: [] });
      expect(prisma.device.delete).toHaveBeenCalledOnce();
      expect(prisma.device.update).not.toHaveBeenCalled();
    });

    it('does no device mutations when node diff is empty', async () => {
      const prisma = makeNodeConfigPrisma({
        nodeConfigFindFirst: { id: 'nc-1', version: 1, isActive: false, nodes: [{ id: 'n1' }] },
      });
      await simulateSave(prisma, { siteGroupId: 'sg-1', orgId: 'org-1', nodes: [{ id: 'n1' }], edges: [] });
      expect(prisma.device.create).not.toHaveBeenCalled();
      expect(prisma.device.update).not.toHaveBeenCalled();
      expect(prisma.device.delete).not.toHaveBeenCalled();
    });
  });

  describe('setActive', () => {
    it('clears all previous active flags before setting new one', async () => {
      const prisma = makeNodeConfigPrisma();
      const nc = {
        id: 'nc-2',
        siteGroupId: 'sg-1',
        siteGroup: { project: { orgId: 'org-1' } },
      };

      await simulateSetActive(prisma, { nodeConfigId: 'nc-2', orgId: 'org-1' }, nc);

      // updateMany should have been called to clear old active flags
      expect(prisma.nodeConfig.updateMany).toHaveBeenCalledOnce();
      const updateManyArgs = vi.mocked(prisma.nodeConfig.updateMany).mock.calls[0]![0] as {
        where: { siteGroupId: string; isActive: boolean };
        data: { isActive: boolean };
      };
      expect(updateManyArgs.where.isActive).toBe(true);
      expect(updateManyArgs.data.isActive).toBe(false);
    });

    it('sets isActive=true, appliedAt, and appliedHash on the target config', async () => {
      const prisma = makeNodeConfigPrisma();
      const nc = {
        id: 'nc-2',
        siteGroupId: 'sg-1',
        siteGroup: { project: { orgId: 'org-1' } },
      };

      await simulateSetActive(
        prisma,
        { nodeConfigId: 'nc-2', orgId: 'org-1', appliedHash: 'abc123' },
        nc,
      );

      expect(prisma.nodeConfig.update).toHaveBeenCalledOnce();
      const updateArgs = vi.mocked(prisma.nodeConfig.update).mock.calls[0]![0] as {
        data: { isActive: boolean; appliedHash: string };
      };
      expect(updateArgs.data.isActive).toBe(true);
      expect(updateArgs.data.appliedHash).toBe('abc123');
    });

    it('throws FORBIDDEN when orgId does not match', async () => {
      const prisma = makeNodeConfigPrisma();
      const nc = {
        id: 'nc-2',
        siteGroupId: 'sg-1',
        siteGroup: { project: { orgId: 'org-OTHER' } },
      };

      await expect(
        simulateSetActive(prisma, { nodeConfigId: 'nc-2', orgId: 'org-1' }, nc),
      ).rejects.toThrow(TRPCError);
    });
  });
});

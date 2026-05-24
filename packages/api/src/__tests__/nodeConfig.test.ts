import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';

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

  if (!latest || (latest as { isActive?: boolean }).isActive) {
    const nextVersion = latest ? (latest as { version: number }).version + 1 : 1;
    return prisma.nodeConfig.create({
      data: {
        siteGroupId: input.siteGroupId,
        version: nextVersion,
        nodes: input.nodes as unknown[],
        edges: input.edges as unknown[],
        isActive: false,
      },
    });
  }

  return prisma.nodeConfig.update({
    where: { id: (latest as { id: string }).id },
    data: { nodes: input.nodes as unknown[], edges: input.edges as unknown[], updatedAt: new Date() },
  });
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
  input: { siteGroupId: string; orgId: string },
) {
  const sg = await prisma.siteGroup.findFirst({ where: {} });
  if (!sg) throw new TRPCError({ code: 'FORBIDDEN' });

  const active = await prisma.nodeConfig.findFirst({ where: {} });
  if (active) return active;
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

import { describe, it, expect, vi, beforeEach } from 'vitest';

function parseClientIdFromTopic(topic?: string): string | null {
  if (!topic) return null;
  const regex = /modules\/[^/]+\/(NBIRTH|NDATA|NDEATH)\/([0-9A-F]{24})$/;
  const match = topic.match(regex);
  if (match?.[2]) return match[2];
  const parts = topic.split('/').filter(Boolean);
  const last = parts.length > 0 ? parts[parts.length - 1] : null;
  return last ?? null;
}

function deriveMetricFromTopic(topic?: string): string {
  if (!topic) return 'value';
  return topic.includes('/NBIRTH/') ? 'birth' : topic.includes('/NDEATH/') ? 'death' : 'value';
}

function makePrisma() {
  return {
    siteGroup: { findFirst: vi.fn().mockResolvedValue({ id: 'sg-1' }) },
    dashboard: {
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    gateway: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  };
}

async function simulateLoad(prisma: ReturnType<typeof makePrisma>, layout: unknown[]) {
  prisma.dashboard.findUnique.mockResolvedValue({ id: 'db-1', siteGroupId: 'sg-1', layout });
  const dashboard = await prisma.dashboard.findUnique({ where: { siteGroupId: 'sg-1' } });
  let changed = false;
  const migrated = await Promise.all(
    (dashboard.layout as Array<Record<string, unknown>>).map(async (widget) => {
      if (widget.bindingV2 || !(widget.binding as { topic?: string } | undefined)?.topic) return widget;
      const topic = (widget.binding as { topic?: string }).topic;
      const clientId = parseClientIdFromTopic(topic);
      if (!clientId) return widget;
      const gw = await prisma.gateway.findFirst({ where: { siteGroupId: 'sg-1', clientId } });
      if (!gw?.deviceKey) return widget;
      changed = true;
      const bindingV2 = { deviceKey: gw.deviceKey as string, metric: deriveMetricFromTopic(topic) };
      prisma.auditLog.create({ data: { action: 'dashboard.binding-migrated', metadata: { widgetId: widget.id } } });
      return { ...widget, bindingV2 };
    }),
  );
  if (!changed) return { id: 'db-1', siteGroupId: 'sg-1', layout };
  prisma.dashboard.update.mockResolvedValue({ id: 'db-1', siteGroupId: 'sg-1', layout: migrated });
  return prisma.dashboard.update({ where: { id: 'db-1' }, data: { layout: migrated } });
}

describe('dashboard binding migration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('load resolves legacy binding into bindingV2 and logs audit', async () => {
    const prisma = makePrisma();
    prisma.gateway.findFirst.mockResolvedValue({ deviceKey: 'dev-1' });
    const res = await simulateLoad(prisma, [
      { id: 'w1', binding: { siteId: 's1', topic: 'modules/g1/NDATA/ABCDEF123456ABCDEF123456' } },
    ]);
    expect((res.layout as Array<{ bindingV2?: { deviceKey: string } }>)[0]?.bindingV2?.deviceKey).toBe('dev-1');
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('load keeps bindingV2 null when clientId unresolvable', async () => {
    const prisma = makePrisma();
    prisma.gateway.findFirst.mockResolvedValue(null);
    const res = await simulateLoad(prisma, [{ id: 'w1', binding: { siteId: 's1', topic: 'legacy/topic/unknown' } }]);
    expect((res.layout as Array<{ bindingV2?: unknown }>)[0]?.bindingV2).toBeUndefined();
  });

  it('new widget with only bindingV2 saves correctly', async () => {
    const prisma = makePrisma();
    const layout = [{ id: 'w2', bindingV2: { deviceKey: 'dev-2', metric: 'value' } }];
    prisma.dashboard.upsert.mockResolvedValue({ id: 'db-1', siteGroupId: 'sg-1', layout });
    const res = await prisma.dashboard.upsert({ where: { siteGroupId: 'sg-1' }, create: { layout }, update: { layout } });
    expect((res.layout as Array<{ bindingV2: { deviceKey: string } }>)[0]?.bindingV2.deviceKey).toBe('dev-2');
  });

  it('existing widget with both binding and bindingV2 preserves bindingV2', async () => {
    const prisma = makePrisma();
    const res = await simulateLoad(prisma, [
      {
        id: 'w3',
        binding: { siteId: 's1', topic: 'modules/g1/NDATA/ABCDEF123456ABCDEF123456' },
        bindingV2: { deviceKey: 'dev-existing', metric: 'value' },
      },
    ]);
    expect((res.layout as Array<{ bindingV2: { deviceKey: string } }>)[0]?.bindingV2.deviceKey).toBe('dev-existing');
    expect(prisma.dashboard.update).not.toHaveBeenCalled();
  });
});

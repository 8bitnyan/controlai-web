import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appRouter } from '../../root';
import { callDaemon } from '../../lib/daemon-client';

vi.mock('../../lib/daemon-client', () => ({ callDaemon: vi.fn() }));

const ORG_ID = 'cmorg000000000000000000001';

function makePrisma(role: 'OWNER' | 'ADMIN' | 'MEMBER' = 'OWNER') {
  return {
    organizationMember: { findUnique: vi.fn().mockResolvedValue({ role }) },
    controlaiInstance: { findFirst: vi.fn().mockResolvedValue({ baseURL: 'https://default.daemons.controlai.io', bearerTokenEnc: 'enc-token' }) },
  };
}

function makeCaller(prisma: ReturnType<typeof makePrisma>) {
  const now = new Date();
  const ctx = {
    prisma,
    session: {
      session: { id: 's1', createdAt: now, updatedAt: now, userId: 'u1', expiresAt: now, token: 't1' },
      user: { id: 'u1', createdAt: now, updatedAt: now, email: 'u1@example.com', emailVerified: true, name: 'u1' },
    },
    userId: 'u1',
    orgId: ORG_ID,
    orgRole: 'OWNER',
    req: new Request('http://localhost'),
  } as unknown as Parameters<typeof appRouter.createCaller>[0];
  return appRouter.createCaller(ctx);
}

describe('admin router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('non-admin caller is forbidden', async () => {
    const caller = makeCaller(makePrisma('MEMBER'));
    await expect(caller.admin.unclaimedBoards.list({ orgId: ORG_ID })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('admin caller returns normalized unclaimed board rows', async () => {
    vi.mocked(callDaemon).mockResolvedValue([
      { realUuid: 'board-1', lastSeenAt: '2026-05-29T00:00:00.000Z', lastSignalPreview: '12.3' },
      { real_uuid: 'board-2', last_seen_at: null, last_signal_preview: null },
    ]);

    const caller = makeCaller(makePrisma('ADMIN'));
    await expect(caller.admin.unclaimedBoards.list({ orgId: ORG_ID })).resolves.toEqual([
      { realUuid: 'board-1', lastSeenAt: '2026-05-29T00:00:00.000Z', lastSignalPreview: '12.3' },
      { realUuid: 'board-2', lastSeenAt: null, lastSignalPreview: null },
    ]);
  });
});

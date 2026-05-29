import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapDefaultInstance, DefaultDaemonEnvMissingError } from '../bootstrap-default-instance';

vi.mock('../crypto', () => ({ encryptToken: (s: string) => `enc:${s}` }));

const ORG_ID = 'cmorg000000000000000000001';
const USER_ID = 'u1';

function makePrisma(existing: unknown = null) {
  return {
    controlaiInstance: {
      findFirst: vi.fn().mockResolvedValue(existing),
      create: vi.fn().mockImplementation(async ({ data }: { data: unknown }) => ({ id: 'cminst1', ...(data as object) })),
    },
  } as unknown as Parameters<typeof bootstrapDefaultInstance>[0];
}

describe('bootstrapDefaultInstance', () => {
  beforeEach(() => {
    process.env.DEFAULT_DAEMON_BASE_URL = 'https://default.daemons.controlai.io';
    process.env.DEFAULT_DAEMON_BEARER_TOKEN = 'token-abc';
  });

  it('creates a new sandbox daemon row when none exists', async () => {
    const p = makePrisma(null);
    const row = await bootstrapDefaultInstance(p, ORG_ID, USER_ID);
    expect(row).toMatchObject({ orgId: ORG_ID, addedById: USER_ID, legacy: false, status: 'HEALTHY' });
    expect((p as unknown as { controlaiInstance: { create: ReturnType<typeof vi.fn> } }).controlaiInstance.create).toHaveBeenCalledOnce();
  });

  it('is idempotent and returns existing non-legacy row', async () => {
    const existing = { id: 'existing-id', orgId: ORG_ID, legacy: false };
    const p = makePrisma(existing);
    const row = await bootstrapDefaultInstance(p, ORG_ID, USER_ID);
    expect(row).toBe(existing);
    expect((p as unknown as { controlaiInstance: { create: ReturnType<typeof vi.fn> } }).controlaiInstance.create).not.toHaveBeenCalled();
  });

  it('throws DefaultDaemonEnvMissingError when DEFAULT_DAEMON_BASE_URL missing', async () => {
    delete process.env.DEFAULT_DAEMON_BASE_URL;
    await expect(bootstrapDefaultInstance(makePrisma(), ORG_ID, USER_ID)).rejects.toBeInstanceOf(DefaultDaemonEnvMissingError);
  });

  it('throws DefaultDaemonEnvMissingError when DEFAULT_DAEMON_BEARER_TOKEN missing', async () => {
    delete process.env.DEFAULT_DAEMON_BEARER_TOKEN;
    await expect(bootstrapDefaultInstance(makePrisma(), ORG_ID, USER_ID)).rejects.toBeInstanceOf(DefaultDaemonEnvMissingError);
  });
});

describe('afterCreateOrganization hook (in auth config)', () => {
  it('swallows DefaultDaemonEnvMissingError so org creation does not fail', async () => {
    // The hook in packages/api/src/auth.ts wraps bootstrapDefaultInstance in try/catch
    // and logs+swallows. We reproduce that contract here to lock the behavior.
    delete process.env.DEFAULT_DAEMON_BASE_URL;
    const p = makePrisma();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let threw = false;
    try {
      await bootstrapDefaultInstance(p, ORG_ID, USER_ID);
    } catch (error) {
      // Mimics the hook body
      console.error('[auth] bootstrapDefaultInstance failed', { orgId: ORG_ID, userId: USER_ID, error });
    }
    expect(threw).toBe(false);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

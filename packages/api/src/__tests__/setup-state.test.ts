import { describe, it, expect, vi } from 'vitest';
import { getSetupState } from '../lib/setup-state';
import type { PrismaClient } from '@controlai-web/db';

function makeMockDb(counts: {
  users: number;
  orgs: number;
  instances: number;
}): PrismaClient {
  return {
    user: { count: vi.fn().mockResolvedValue(counts.users) },
    organization: { count: vi.fn().mockResolvedValue(counts.orgs) },
    controlaiInstance: { count: vi.fn().mockResolvedValue(counts.instances) },
  } as unknown as PrismaClient;
}

describe('getSetupState', () => {
  it('returns all false on empty DB', async () => {
    const db = makeMockDb({ users: 0, orgs: 0, instances: 0 });
    const state = await getSetupState(db);
    expect(state.firstUserDone).toBe(false);
    expect(state.firstOrgDone).toBe(false);
    expect(state.firstInstanceDone).toBe(false);
    expect(state.isComplete).toBe(false);
  });

  it('returns correct states after full seed', async () => {
    const db = makeMockDb({ users: 1, orgs: 1, instances: 1 });
    const state = await getSetupState(db);
    expect(state.firstUserDone).toBe(true);
    expect(state.firstOrgDone).toBe(true);
    expect(state.firstInstanceDone).toBe(true);
    expect(state.isComplete).toBe(true);
  });

  it('returns partial state when user exists but no org', async () => {
    const db = makeMockDb({ users: 1, orgs: 0, instances: 0 });
    const state = await getSetupState(db);
    expect(state.firstUserDone).toBe(true);
    expect(state.firstOrgDone).toBe(false);
    expect(state.isComplete).toBe(false);
  });
});

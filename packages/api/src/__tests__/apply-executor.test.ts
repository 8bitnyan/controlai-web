import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Op } from '@controlai-web/shared-types';

// Mock daemon-client
vi.mock('../lib/daemon-client', () => ({
  callDaemon: vi.fn(),
  DaemonError: class DaemonError extends Error {
    statusCode: number;
    body: string;
    url: string;
    constructor(statusCode: number, body: string, url: string) {
      super(`Daemon ${statusCode}`);
      this.statusCode = statusCode;
      this.body = body;
      this.url = url;
      this.name = 'DaemonError';
    }
  },
}));

import { executeOp } from '../lib/apply-executor';
import { callDaemon } from '../lib/daemon-client';

const mockInstance = { baseURL: 'https://daemon.example.com', bearerTokenEnc: 'enc' };

const makeOp = (overrides: Partial<Op> = {}): Op => ({
  id: 'op-1',
  type: 'createTenant',
  description: 'Create tenant',
  path: '/v1/tenants',
  method: 'POST',
  body: { slug: 'default' },
  ...overrides,
});

describe('executeOp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns success on 200 response', async () => {
    vi.mocked(callDaemon).mockResolvedValue({ id: 'tenant-123' });
    const { result, tenantId } = await executeOp(makeOp({ type: 'createTenant' }), mockInstance);
    expect(result.status).toBe('success');
    expect(tenantId).toBe('tenant-123');
  });

  it('treats 409 on createTenant as idempotent success', async () => {
    const DaemonErr = (await import('../lib/daemon-client')).DaemonError;
    vi.mocked(callDaemon).mockRejectedValue(
      new DaemonErr(409, '{"id":"existing-tenant"}', '/v1/tenants'),
    );
    const { result } = await executeOp(makeOp({ type: 'createTenant' }), mockInstance);
    expect(result.status).toBe('success');
  });

  it('treats 409 on createSite as idempotent success', async () => {
    const DaemonErr = (await import('../lib/daemon-client')).DaemonError;
    vi.mocked(callDaemon).mockRejectedValue(
      new DaemonErr(409, '{"id":"existing-site"}', '/v1/tenants/x/sites'),
    );
    const { result } = await executeOp(
      makeOp({ type: 'createSite', path: '/v1/tenants/:tenantId/sites' }),
      mockInstance,
    );
    expect(result.status).toBe('success');
  });

  it('returns failed on 500 response', async () => {
    const DaemonErr = (await import('../lib/daemon-client')).DaemonError;
    vi.mocked(callDaemon).mockRejectedValue(
      new DaemonErr(500, '{"error":"capacity guard rejected"}', '/v1/tenants/x/sites'),
    );
    const { result } = await executeOp(makeOp({ type: 'createSite' }), mockInstance);
    expect(result.status).toBe('failed');
    expect(result.daemonStatusCode).toBe(500);
    expect(result.errorDetail).toContain('capacity guard rejected');
  });

  it('truncates error detail to 2 KB', async () => {
    const DaemonErr = (await import('../lib/daemon-client')).DaemonError;
    const longBody = 'x'.repeat(5000);
    vi.mocked(callDaemon).mockRejectedValue(
      new DaemonErr(500, longBody, '/v1/tenants/x/sites'),
    );
    const { result } = await executeOp(makeOp({ type: 'createSite' }), mockInstance);
    expect(result.errorDetail!.length).toBeLessThanOrEqual(2048);
  });

  it('resolves tenantId from createTenant response', async () => {
    vi.mocked(callDaemon).mockResolvedValue({ id: 'new-tenant-id' });
    const { tenantId } = await executeOp(makeOp({ type: 'createTenant' }), mockInstance);
    expect(tenantId).toBe('new-tenant-id');
  });

  it('resolves siteId from createSite response', async () => {
    vi.mocked(callDaemon).mockResolvedValue({ id: 'new-site-id' });
    const { siteId } = await executeOp(
      makeOp({ type: 'createSite' }),
      mockInstance,
      { tenantId: 'tenant-1' },
    );
    expect(siteId).toBe('new-site-id');
  });
});

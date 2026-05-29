import { afterEach, describe, expect, it, vi } from 'vitest';
import { revokeCert } from '../daemon-cert-revoke';

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.PROVISIONING_DAEMON_URL;
});

describe('revokeCert', () => {
  it('returns ok true on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await revokeCert({
      tenantId: 'tenant-a',
      fingerprint: 'fp-a',
      daemonUrl: 'https://daemon.local',
    });

    expect(result).toEqual({ ok: true });
  });

  it('returns soft-success on 404', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await revokeCert({
      tenantId: 'tenant-a',
      fingerprint: 'fp-a',
      daemonUrl: 'https://daemon.local',
    });

    expect(result).toEqual({ ok: true, message: 'daemon does not support revocation; skip' });
  });

  it('returns hard-failure body summary for unsupported status', async () => {
    const longBody = `${'x'.repeat(220)} body`;
    const fetchMock = vi.fn().mockResolvedValue(new Response(longBody, { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await revokeCert({
      tenantId: 'tenant-a',
      fingerprint: 'fp-a',
      daemonUrl: 'https://daemon.local',
    });

    expect(result.ok).toBe(false);
    expect(result.message).toBeDefined();
    expect(result.message!.length).toBeLessThanOrEqual(200);
  });

  it('returns network error on fetch rejection', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('socket hang up'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await revokeCert({
      tenantId: 'tenant-a',
      fingerprint: 'fp-a',
      daemonUrl: 'https://daemon.local',
    });

    expect(result).toEqual({ ok: false, message: 'network error: socket hang up' });
  });

  it('uses PROVISIONING_DAEMON_URL by default', async () => {
    process.env.PROVISIONING_DAEMON_URL = 'https://env-daemon.local';
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await revokeCert({ tenantId: 'tenant-env', fingerprint: 'fp-env' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://env-daemon.local/v1/tenants/tenant-env/certs/fp-env',
      { method: 'DELETE' },
    );
  });
});

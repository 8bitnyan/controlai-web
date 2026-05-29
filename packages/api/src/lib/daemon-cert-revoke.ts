const SOFT_SUCCESS_MESSAGE = 'daemon does not support revocation; skip';

type RevokeCertInput = {
  tenantId: string;
  fingerprint: string;
  daemonUrl?: string;
};

type RevokeCertResult = {
  ok: boolean;
  message?: string;
};

function summarizeBody(body: string): string {
  const compact = body.trim().replace(/\s+/g, ' ');
  return compact.slice(0, 200);
}

export async function revokeCert({
  tenantId,
  fingerprint,
  daemonUrl,
}: RevokeCertInput): Promise<RevokeCertResult> {
  const baseUrl = daemonUrl ?? process.env.PROVISIONING_DAEMON_URL;
  if (!baseUrl) {
    return { ok: false, message: 'network error: PROVISIONING_DAEMON_URL is not set' };
  }

  const url = new URL(
    `/v1/tenants/${encodeURIComponent(tenantId)}/certs/${encodeURIComponent(fingerprint)}`,
    baseUrl,
  ).toString();

  try {
    const response = await fetch(url, { method: 'DELETE' });

    if (response.status === 200 || response.status === 204) {
      return { ok: true };
    }

    if (response.status === 404 || response.status === 405 || response.status === 501) {
      return { ok: true, message: SOFT_SUCCESS_MESSAGE };
    }

    const bodyText = summarizeBody(await response.text());
    const fallback = `HTTP ${response.status}`;
    return { ok: false, message: bodyText || fallback };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `network error: ${message}` };
  }
}

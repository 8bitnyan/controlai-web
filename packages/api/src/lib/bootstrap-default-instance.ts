import type { PrismaClient } from '@controlai-web/db';
import { encryptToken } from './crypto';

export class DefaultDaemonEnvMissingError extends Error {
  constructor(varName: string) {
    super(`${varName} is required`);
    this.name = 'DefaultDaemonEnvMissingError';
  }
}

/**
 * Idempotently bootstrap the singleton default-daemon `ControlaiInstance`
 * row for an organization. Reuses the existing row if one is present
 * (legacy=false). Returns the instance row.
 *
 * Throws `DefaultDaemonEnvMissingError` if either env var is missing.
 */
export async function bootstrapDefaultInstance(
  prisma: PrismaClient,
  orgId: string,
  addedById: string,
) {
  const baseURL = process.env.DEFAULT_DAEMON_BASE_URL;
  const bearerToken = process.env.DEFAULT_DAEMON_BEARER_TOKEN;
  if (!baseURL) throw new DefaultDaemonEnvMissingError('DEFAULT_DAEMON_BASE_URL');
  if (!bearerToken) throw new DefaultDaemonEnvMissingError('DEFAULT_DAEMON_BEARER_TOKEN');

  const existing = await prisma.controlaiInstance.findFirst({
    where: { orgId, legacy: false },
  });
  if (existing) return existing;

  return prisma.controlaiInstance.create({
    data: {
      orgId,
      name: 'Sandbox daemon',
      baseURL,
      bearerTokenEnc: encryptToken(bearerToken),
      status: 'HEALTHY',
      lastSeenAt: new Date(),
      addedById,
      legacy: false,
    },
  });
}

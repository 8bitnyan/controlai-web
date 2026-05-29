import { prisma } from '@controlai-web/db';

const REMEDIATION_CMD = 'pnpm --filter @controlai-web/db db:migrate-devices --site-group <id>';

export async function enforceGatewayDeviceKeyStartupGate(
  env = process.env.NODE_ENV,
  logger: Pick<Console, 'warn' | 'error'> = console,
  exit: (code: number) => never = process.exit,
): Promise<void> {
  const nullDeviceKeyCount = await prisma.gateway.count({ where: { deviceKey: null } });
  if (nullDeviceKeyCount <= 0) {
    return;
  }

  const message = `[startup-gate] ${nullDeviceKeyCount} Gateway rows have null deviceKey — run ${REMEDIATION_CMD}`;
  if (env === 'production') {
    logger.error(message);
    exit(1);
    return;
  }

  logger.warn(message);
}

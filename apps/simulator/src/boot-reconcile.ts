import pino from 'pino';
import { prisma } from '@controlai-web/db';
import { startGateway } from './manager.js';

const logger = pino({ name: 'boot-reconcile' });

/**
 * On startup, find all Gateway rows where desiredState='running'
 * and start a simulator client for each.
 */
export async function reconcileOnBoot(): Promise<void> {
  const gateways = await prisma.gateway.findMany({
    where: { desiredState: 'running' },
    select: { id: true, label: true },
  });

  if (gateways.length === 0) {
    logger.info('No gateways to reconcile on boot');
    return;
  }

  logger.info({ count: gateways.length }, 'Reconciling gateways on boot');

  for (const gw of gateways) {
    try {
      await startGateway(gw.id);
      logger.info({ gatewayId: gw.id, label: gw.label }, 'Gateway reconciled');
    } catch (err) {
      logger.error({ gatewayId: gw.id, err }, 'Failed to reconcile gateway on boot');
    }
  }
}

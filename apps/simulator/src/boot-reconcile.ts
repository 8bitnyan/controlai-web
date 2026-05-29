import pino from 'pino';
import { prisma } from '@controlai-web/db';
import { reconcileSiteGroup } from './manager.js';

const logger = pino({ name: 'boot-reconcile' });

/**
 * On startup, find all SiteGroups with simulationDesired Devices
 * and reconcile simulator runtime per SiteGroup.
 */
export async function reconcileOnBoot(): Promise<void> {
  const groups = await prisma.device.groupBy({
    where: { simulationDesired: true },
    by: ['siteGroupId'],
  });

  const siteGroupIds = groups.map((group) => group.siteGroupId);

  if (siteGroupIds.length === 0) {
    logger.info('No site groups to reconcile on boot');
    return;
  }

  logger.info({ count: siteGroupIds.length }, 'Reconciling site groups on boot');

  for (const siteGroupId of siteGroupIds) {
    try {
      await reconcileSiteGroup(siteGroupId);
      logger.info({ siteGroupId }, 'SiteGroup reconciled');
    } catch (err) {
      logger.error({ siteGroupId, err }, 'Failed to reconcile site group on boot');
    }
  }
}

import { prisma } from '@controlai-web/db';
import type { BrokerConfig } from './mqtt-manager';

/**
 * Looks up the MQTT broker config for a site from Postgres.
 * Returns null if the site has no mTLS cert (not yet provisioned).
 */
export async function getBrokerConfig(siteId: string): Promise<BrokerConfig | null> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    include: {
      siteGroup: {
        include: {
          project: {
            include: { instance: true },
          },
        },
      },
    },
  });

  if (!site) return null;

  const instance = site.siteGroup.project.instance;
  const baseURL = instance.baseURL.replace(/\/$/, '');

  // Parse host from base URL
  const url = new URL(baseURL);
  const mqttPort = 8883; // default mTLS port
  const brokerUrl = `mqtts://${url.hostname}:${mqttPort}`;

  return {
    url: brokerUrl,
    clientCert: site.mqttCert ?? undefined,
    clientKey: site.mqttKey ?? undefined,
  };
}

import { prisma } from '@controlai-web/db';
import type { BrokerConfig } from './mqtt-manager';
import { decryptToken } from './crypto';

const tenantCaCache = new Map<string, string>();

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
  const host = url.hostname;
  const brokerUrl = `mqtts://${host}:${mqttPort}`;

  let caCert = tenantCaCache.get(site.controlaiTenantId ?? '');
  if (!caCert && site.controlaiTenantId) {
    try {
      const token = decryptToken(instance.bearerTokenEnc);
      const caResp = await fetch(`${baseURL}/v1/tenants/${site.controlaiTenantId}/pki/ca`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (caResp.ok) {
        const caJson = (await caResp.json()) as { ca_pem?: string };
        if (caJson.ca_pem) {
          caCert = caJson.ca_pem;
          tenantCaCache.set(site.controlaiTenantId, caJson.ca_pem);
        }
      } else {
        console.warn(
          `[broker-registry] daemon /pki/ca returned ${caResp.status} for tenant ${site.controlaiTenantId}; falling back to rejectUnauthorized:false`,
        );
      }
    } catch (err) {
      console.warn(
        `[broker-registry] CA fetch failed for tenant ${site.controlaiTenantId} (${err instanceof Error ? err.message : String(err)}); falling back to rejectUnauthorized:false`,
      );
    }
  }

  return {
    url: brokerUrl,
    host,
    port: mqttPort,
    servername: site.tlsServername ?? undefined,
    caCert,
    clientCert: site.mqttCert ?? undefined,
    clientKey: site.mqttKey ?? undefined,
  };
}

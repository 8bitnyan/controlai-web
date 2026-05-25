#!/usr/bin/env tsx
import { PrismaClient } from '@controlai-web/db';
import { decryptToken } from '../packages/api/src/lib/crypto';

const SITE_GROUP_ID = 'cmpjyzwrz000db95tu9uusq4b';

async function main() {
  const prisma = new PrismaClient();
  const site = await prisma.site.findFirst({
    where: { siteGroupId: SITE_GROUP_ID },
    include: { siteGroup: { include: { project: { include: { instance: true } } } } },
  });
  if (!site) throw new Error('site missing');
  const inst = site.siteGroup.project.instance;
  const token = decryptToken(inst.bearerTokenEnc);

  const r = await fetch(
    `${inst.baseURL.replace(/\/$/, '')}/v1/tenants/${site.controlaiTenantId}/sites/${site.controlaiSiteId}/pki/certs`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ gateway: 'mqtt-bridge' }),
    },
  );
  if (!r.ok) throw new Error(`pki: ${r.status} ${await r.text()}`);
  const cert = (await r.json()) as { cert_pem: string; key_pem: string };

  await prisma.site.update({
    where: { id: site.id },
    data: { mqttCert: cert.cert_pem, mqttKey: cert.key_pem },
  });
  console.log(`stamped site ${site.id} with mqttCert (${cert.cert_pem.length}B) + mqttKey (${cert.key_pem.length}B)`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });

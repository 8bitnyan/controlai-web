#!/usr/bin/env tsx
/** Manually upsert the Site row matching the mosquitto site on AWS. */
import { PrismaClient } from '@controlai-web/db';

const SITE_GROUP_ID = 'cmpjyzwrz000db95tu9uusq4b';
const CONTROLAI_TENANT_ID = 'tnt_default';
const CONTROLAI_SITE_ID = 'ste_sbe9909e0-7bf5-40a4-86e8-090f52d33e02';
const DOMAIN = '52-79-241-139.nip.io';

async function main() {
  const prisma = new PrismaClient();
  const sni = `${CONTROLAI_SITE_ID}.${CONTROLAI_TENANT_ID}.${DOMAIN}`;

  const sg = await prisma.siteGroup.findUnique({ where: { id: SITE_GROUP_ID } });
  if (!sg) throw new Error(`SiteGroup ${SITE_GROUP_ID} not found`);

  const existing = await prisma.site.findFirst({ where: { siteGroupId: SITE_GROUP_ID } });
  if (existing) {
    await prisma.site.update({
      where: { id: existing.id },
      data: {
        controlaiTenantId: CONTROLAI_TENANT_ID,
        controlaiSiteId: CONTROLAI_SITE_ID,
        tlsServername: sni,
      },
    });
    console.log(`updated existing Site ${existing.id}; sni=${sni}`);
  } else {
    const created = await prisma.site.create({
      data: {
        siteGroupId: SITE_GROUP_ID,
        name: sg.name,
        controlaiTenantId: CONTROLAI_TENANT_ID,
        controlaiSiteId: CONTROLAI_SITE_ID,
        tlsServername: sni,
      },
    });
    console.log(`created Site ${created.id}; sni=${sni}`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });

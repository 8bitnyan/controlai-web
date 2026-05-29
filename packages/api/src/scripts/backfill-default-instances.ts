import { prisma } from '@controlai-web/db';
import { bootstrapDefaultInstance } from '../lib/bootstrap-default-instance';

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  let created = 0;
  let skipped = 0;

  for (const org of orgs) {
    const existing = await prisma.controlaiInstance.findFirst({
      where: { orgId: org.id, legacy: false },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      continue;
    }
    const member = await prisma.organizationMember.findFirst({
      where: { orgId: org.id },
      select: { userId: true },
    });
    if (!member?.userId) {
      skipped += 1;
      continue;
    }
    await bootstrapDefaultInstance(prisma, org.id, member.userId);
    created += 1;
  }

  console.log(`[backfill-default-instances] total=${orgs.length} created=${created} skipped=${skipped}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('[backfill-default-instances] failed', err);
  process.exit(1);
});

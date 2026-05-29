import { prisma } from './src/index';

const SG_ID = 'cmpqglevp000ttcp4kw61evzb';
const runs = await prisma.applyRun.findMany({
  where: { siteGroupId: SG_ID },
  orderBy: { createdAt: 'desc' },
  take: 2,
});

for (const r of runs) {
  console.log('---', r.createdAt.toISOString(), 'success=', r.success, 'failedAt=', r.failedAt);
  console.log(JSON.stringify(r.resultJson, null, 2));
}
await prisma.$disconnect();

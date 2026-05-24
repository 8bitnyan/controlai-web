import { prisma } from './src/client';
async function main() {
  const sgId = 'cmpjyzwrz000db95tu9uusq4b';
  const sg = await prisma.siteGroup.findUnique({
    where: { id: sgId },
    include: {
      project: { include: {       instance: { select: { id: true, baseURL: true, status: true, lastSeenAt: true } }  } },
      sites: true,
    },
  });
  console.log('SiteGroup:', JSON.stringify(sg, null, 2));
  const ncs = await prisma.nodeConfig.findMany({
    where: { siteGroupId: sgId },
    orderBy: { version: 'desc' },
  });
  console.log('NodeConfig count:', ncs.length);
  for (const nc of ncs) {
    const nodes: any = nc.nodes;
    const edges: any = nc.edges;
    console.log({
      id: nc.id, version: nc.version, isActive: nc.isActive, appliedAt: nc.appliedAt,
      nodeCount: Array.isArray(nodes) ? nodes.length : '?',
      edgeCount: Array.isArray(edges) ? edges.length : '?',
    });
  }
  if (ncs[0]) {
    console.log('Latest nodes:', JSON.stringify(ncs[0].nodes, null, 2));
    console.log('Latest edges:', JSON.stringify(ncs[0].edges, null, 2));
  }
  const runs = await prisma.applyRun.findMany({ where: { siteGroupId: sgId }, orderBy: { createdAt: 'desc' }, take: 5 });
  console.log('ApplyRuns:', JSON.stringify(runs, null, 2));
}
main().finally(() => prisma.$disconnect());

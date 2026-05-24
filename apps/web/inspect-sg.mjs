import { PrismaClient } from '@controlai-web/db';
const p = new PrismaClient();
const sgId = 'cmpjyzwrz000db95tu9uusq4b';
const sg = await p.siteGroup.findUnique({
  where: { id: sgId },
  include: {
    project: { include: { instance: { select: { id: true, baseURL: true, healthStatus: true } } } },
    sites: true,
  },
});
console.log('SiteGroup:', JSON.stringify(sg, null, 2));
const ncs = await p.nodeConfig.findMany({
  where: { siteGroupId: sgId },
  orderBy: { version: 'desc' },
  select: { id: true, version: true, isActive: true, appliedAt: true, appliedHash: true, createdAt: true, nodes: true, edges: true },
});
console.log('NodeConfigs count:', ncs.length);
for (const nc of ncs) {
  const nodes = nc.nodes;
  const edges = nc.edges;
  console.log({ id: nc.id, version: nc.version, isActive: nc.isActive, appliedAt: nc.appliedAt, nodeCount: Array.isArray(nodes) ? nodes.length : '?', edgeCount: Array.isArray(edges) ? edges.length : '?' });
}
if (ncs[0]) {
  console.log('Latest nodes:', JSON.stringify(ncs[0].nodes, null, 2));
  console.log('Latest edges:', JSON.stringify(ncs[0].edges, null, 2));
}
const runs = await p.applyRun.findMany({ where: { siteGroupId: sgId }, orderBy: { createdAt: 'desc' }, take: 5 });
console.log('ApplyRuns:', JSON.stringify(runs, null, 2));
await p.$disconnect();

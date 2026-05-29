import type { Prisma } from '@controlai-web/db';

type NodeShape = {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Prisma.InputJsonObject;
  parentCanvasNodeId?: string;
};

type EdgeShape = { id: string; source: string; target: string };

export async function appendNodeToNodeConfig(
  tx: Prisma.TransactionClient,
  siteGroupId: string,
  nodeShape: NodeShape,
): Promise<void> {
  const active = await tx.nodeConfig.findFirst({
    where: { siteGroupId, isActive: true },
    orderBy: { version: 'desc' },
  });
  if (!active) return;

  const nodes: unknown[] = Array.isArray(active.nodes) ? [...active.nodes] : [];
  const edges: unknown[] = Array.isArray(active.edges) ? [...active.edges] : [];
  nodes.push({
    id: nodeShape.id,
    type: nodeShape.type,
    position: nodeShape.position,
    data: nodeShape.data,
  });
  if (nodeShape.parentCanvasNodeId) {
    edges.push({
      id: `e-${nodeShape.parentCanvasNodeId}-${nodeShape.id}`,
      source: nodeShape.parentCanvasNodeId,
      target: nodeShape.id,
    } as EdgeShape);
  }

  await tx.nodeConfig.update({
    where: { id: active.id },
    data: { nodes: nodes as Prisma.InputJsonValue, edges: edges as Prisma.InputJsonValue, updatedAt: new Date() },
  });
}

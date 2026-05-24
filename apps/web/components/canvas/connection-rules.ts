/**
 * Re-exports from shared-types for use in the canvas and tests.
 * The CONNECTION_MATRIX is the single source of truth.
 */
export {
  CONNECTION_MATRIX,
  isValidNodeConnection,
} from '@controlai-web/shared-types';
export type { NodeType } from '@controlai-web/shared-types';

import type { Connection, Node } from '@xyflow/react';
import { isValidNodeConnection } from '@controlai-web/shared-types';
import type { NodeData, NodeType } from '@controlai-web/shared-types';

/**
 * @xyflow isValidConnection callback.
 * Returns true if the connection source→target is allowed by the CONNECTION_MATRIX.
 */
export function isValidConnection(
  connection: Connection,
  nodes: Node<NodeData>[],
): boolean {
  const sourceNode = nodes.find((n) => n.id === connection.source);
  const targetNode = nodes.find((n) => n.id === connection.target);

  if (!sourceNode || !targetNode) return false;

  const sourceType = sourceNode.type;
  const targetType = targetNode.type;

  if (!sourceType || !targetType) return false;

  return isValidNodeConnection(
    sourceType as NodeType,
    targetType as NodeType,
  );
}

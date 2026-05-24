import type { NodeType } from './node-types';

/**
 * CONNECTION_MATRIX defines valid source→target pairs for the canvas editor.
 * Sensor    → Gateway ✓, Broker ✓
 * Gateway   → Broker ✓, Ingest ✓
 * Broker    → Ingest ✓, Monitoring ✓
 * Ingest    → TimescaleDB ✓, Monitoring ✓
 * TimescaleDB → Monitoring ✓
 * Monitoring → (terminal, no outgoing)
 */
export const CONNECTION_MATRIX: Record<NodeType, NodeType[]> = {
  sensor: ['gateway', 'broker'],
  gateway: ['broker', 'ingest'],
  broker: ['ingest', 'monitoring'],
  ingest: ['timescaledb', 'monitoring'],
  timescaledb: ['monitoring'],
  monitoring: [],
};

/**
 * Returns true if the connection from sourceType → targetType is allowed.
 */
export function isValidNodeConnection(sourceType: NodeType, targetType: NodeType): boolean {
  return CONNECTION_MATRIX[sourceType]?.includes(targetType) ?? false;
}

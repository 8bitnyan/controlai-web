import { encode } from 'cbor-x';
import type { GatewayDTO, SensorConfig } from './types.js';

// Firmware version constant (u32)
const FIRMWARE_VERSION = 1;

/**
 * Build the MQTT topic for a given message type.
 * Pattern: modules/{groupId}/{msgType}/{clientId}
 */
export function topicFor(g: Pick<GatewayDTO, 'groupId' | 'clientId'>, msgType: string): string {
  return `modules/${g.groupId}/${msgType}/${g.clientId}`;
}

/**
 * Encode an NBIRTH payload (connect announcement).
 * Contains full settings and sensor metadata.
 */
export function encodeNbirth(g: GatewayDTO, sensors: SensorConfig[]): Buffer {
  const payload = {
    id: idBuffer(g.id),
    type: 'MAIN',
    version: FIRMWARE_VERSION,
    state: 'NORMAL',
    stateMSG: 'Online',
    info: {
      label: g.label,
      kind: g.kind,
      mode: g.mode,
    },
    settings: {
      sensors: sensors.map((s) => ({
        id: s.id,
        type: s.type,
        unit: s.unit ?? '',
        min: s.min,
        max: s.max,
        intervalMs: s.intervalMs,
      })),
    },
  };
  return Buffer.from(encode(payload) as Uint8Array);
}

/**
 * Encode an NDATA payload (periodic sensor readings).
 */
export function encodeNdata(
  g: GatewayDTO,
  readings: Array<{ sensorId: string; value: number; ts: number }>,
): Buffer {
  const payload = {
    id: idBuffer(g.id),
    type: 'MAIN',
    version: FIRMWARE_VERSION,
    state: 'NORMAL',
    stateMSG: 'Online',
    info: {},
    readings,
  };
  return Buffer.from(encode(payload) as Uint8Array);
}

/**
 * Encode an NDEATH payload (LWT / graceful disconnect).
 */
export function encodeNdeath(g: GatewayDTO): Buffer {
  const payload = {
    id: idBuffer(g.id),
    type: 'MAIN',
    version: FIRMWARE_VERSION,
    state: 'OFFLINE',
    stateMSG: 'Disconnecting',
    info: {},
    settings: {},
  };
  return Buffer.from(encode(payload) as Uint8Array);
}

/**
 * Convert a CUID gateway id to a 12-byte Buffer by hashing/truncating.
 * We use the first 24 hex chars of a hex representation derived from the string.
 */
function idBuffer(id: string): Buffer {
  // Take UTF-8 bytes of first 12 chars of id (CUIDs are 25 chars)
  return Buffer.from(id.slice(0, 12), 'utf8');
}

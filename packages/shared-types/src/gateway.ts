// ─── Gateway shared types ──────────────────────────────────────────────────────

export type GatewayKind = 'simulator' | 'physical';
export type GatewayMode = 'cbor-modules-cloud' | 'json';
export type GatewayStatus = 'stopped' | 'connecting' | 'connected' | 'error' | 'disconnected';
export type SensorType = 'temperature' | 'pressure' | 'humidity' | 'vibration';

export interface SensorConfig {
  id: string;
  type: SensorType;
  min: number;
  max: number;
  walkStep: number;
  intervalMs: number;
  unit?: string;
  seed?: number;
}

export interface GatewayDTO {
  id: string;
  siteGroupId: string;
  label: string;
  kind: GatewayKind;
  mode: GatewayMode;
  endpointURL: string;
  tlsServername: string | null;
  brokerHost: string | null;
  brokerPort: number | null;
  groupId: string;
  clientId: string;
  sensors: SensorConfig[];
  jsonTopicTemplate: string | null;
  desiredState: 'stopped' | 'running';
  lastStatus: GatewayStatus;
  lastError: string | null;
}

export interface DetectBrokerEndpointResult {
  brokerHost: string;
  brokerPort: number;
  tlsServername: string;
  endpointURL: string;
}

// modules_cloud-main CBOR payload schema (top-level fields):
export interface CborBirthPayload {
  id: Uint8Array;      // 12-byte gateway uuid
  type: string;        // 'MAIN'
  version: number;     // u32 firmware version
  state: 'NORMAL';
  stateMSG: string;
  info: Record<string, unknown>;
  settings: Record<string, unknown>;
}

export interface CborDataPayload extends Omit<CborBirthPayload, 'settings'> {
  // settings omitted on NDATA
  readings: Array<{ sensorId: string; value: number; ts: number }>;
}

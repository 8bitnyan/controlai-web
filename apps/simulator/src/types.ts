import type { GatewayDTO as SharedGatewayDTO, SensorConfig as SharedSensorConfig } from '@controlai-web/shared-types';

export type GatewayDTO = SharedGatewayDTO;

export interface SensorConfig extends SharedSensorConfig {
  deviceTypeId?: string;
  label?: string;
  pattern?: 'tilt' | 'vibration' | 'crack-encoder' | 'noise-meter' | 'vibrating-wire' | 'random-walk' | 'random' | 'sine';
  chainLength?: number;
  tiltDriftRate?: number;
  vibrationAmplitude?: number;
  vibrationFrequency?: number;
  burstRate?: number;
  noiseFloor?: number;
  noisePeak?: number;
  vwDriftRate?: number;
  vwDampingRatio?: number;
  vwResonanceAmplitude?: number;
}

export interface InboundEvent {
  siteGroupId: string;
  topic: string;
  msgType: 'NBIRTH' | 'NDATA' | 'NDEATH' | string;
  clientId: string;
  ts: number;
  payloadSummary: string;
  readings?: Array<{ sensorId: string; value: number; ts: number }>;
  source: 'sim' | 'board';
}

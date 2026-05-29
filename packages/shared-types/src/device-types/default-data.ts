import { getDeviceType } from './registry';

export const LEGACY_TYPE_MAP = {
  sensor: 'core-generic-sensor',
  gateway: 'core-generic-gateway',
  broker: 'core-generic-broker',
  ingest: 'core-generic-ingest',
  timescaledb: 'core-generic-tsdb',
  monitoring: 'core-generic-monitoring',
} as const;

export function defaultNodeData(deviceTypeId: string): {
  deviceTypeId: string;
  category: string;
  label: string;
  visual: { iconRef: string; accentColor: string; badge?: string };
  config: Record<string, never>;
  status: 'normal';
  msgPerSec: number;
} {
  const manifest = getDeviceType(deviceTypeId);
  if (!manifest) {
    throw new Error(`Unknown device type: ${deviceTypeId}`);
  }

  return {
    deviceTypeId: manifest.id,
    category: manifest.category,
    label: manifest.displayName,
    visual: manifest.visual,
    config: {},
    status: 'normal',
    msgPerSec: 0,
  };
}

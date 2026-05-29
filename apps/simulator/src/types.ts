import type { GatewayDTO as SharedGatewayDTO, SensorConfig as SharedSensorConfig } from '@controlai-web/shared-types';

export type GatewayDTO = SharedGatewayDTO;

export interface SensorConfig extends SharedSensorConfig {
  deviceTypeId?: string;
  label?: string;
  pattern?: string;
}

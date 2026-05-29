export type RegistrationConfidence =
  | 'EXACT'
  | 'PORT_AND_ADDRESS'
  | 'ORDER_FALLBACK'
  | 'LABEL_HEURISTIC'
  | 'LAST_KNOWN'
  | 'NONE';

export type DiscoveredChild = {
  raw: string;
  address: number;
  firmwareTypeCode: string;
  serialAscii: string | null;
  reportedTypeLabel: string;
  portId: string;
};

export type ChildMatch = {
  shadowDeviceKey: string;
  discovered: DiscoveredChild;
  confidence: RegistrationConfidence;
  resolvedDeviceTypeId: string;
  proposedPortBindings: { parentPortId: string; address: number };
};

export type RegistrationDecisions = {
  confirmedMatches: { shadowDeviceKey: string; discoveredRaw: string }[];
  acceptExtras: { discoveredRaw: string; deviceTypeId: string; placeOnCanvas: boolean }[];
  rejectShadows: { shadowDeviceKey: string; action: 'soft-archive' | 'keep-simulated' | 'keep-as-manual' }[];
};

export type MatchPlan = {
  confirmedMatches: ChildMatch[];
  unmatchedShadows: { deviceKey: string; reason: string }[];
  extras: DiscoveredChild[];
  unknownTypes: DiscoveredChild[];
  gatewayMatch: { boardReportedUuid: string };
};

export const DEVICE_CONNECTION_RULES: Record<string, { allowedParentDeviceTypeIds?: string[]; allowSelfChain?: boolean; allowedParentCategory?: 'gateway' }> = {
  'core-generic-noise-meter': { allowedParentDeviceTypeIds: ['core-generic-sensor-input'] },
  'core-generic-tilt-linear': { allowSelfChain: true, allowedParentCategory: 'gateway' },
  'core-generic-sensor-input': { allowedParentCategory: 'gateway' },
  'core-generic-vibration-tilt-standalone': { allowedParentCategory: 'gateway' },
  'core-generic-control-485x2': { allowedParentCategory: 'gateway' },
  'core-generic-vibrating-wire-sensor': { allowedParentCategory: 'gateway' },
};

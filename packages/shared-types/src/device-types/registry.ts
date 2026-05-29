import { DeviceType, DeviceTypeSchema } from './schema';
import { ProtocolFamily } from './protocol-families';

const registry = new Map<string, DeviceType>();
const registrationCallSite = new Map<string, string>();

function captureCaller(): string {
  const stack = new Error().stack ?? '';
  const lines = stack.split('\n');
  return lines[3]?.trim() ?? '<unknown>';
}

function inferSensorOutProtocols(manifest: DeviceType): ProtocolFamily[] {
  if (manifest.defaultSignal?.format === 'binary') return ['analog-4-20ma'];
  return ['modbus-rtu', 'rs485-serial-generic'];
}

function sourceOutProtocols(source: DeviceType): ProtocolFamily[] {
  if (source.category === 'sensor' && source.ports.length === 0) return inferSensorOutProtocols(source);
  return source.ports.flatMap((p) => p.acceptsProtocols);
}

export function registerDeviceType(manifest: unknown): void {
  const parsed = DeviceTypeSchema.parse(manifest);
  if (registry.has(parsed.id)) {
    throw new Error(`Duplicate device-type id: ${parsed.id}. First registration: ${registrationCallSite.get(parsed.id)}`);
  }
  registry.set(parsed.id, parsed);
  registrationCallSite.set(parsed.id, captureCaller());
}

export function getDeviceType(deviceTypeId: string): DeviceType | undefined {
  return registry.get(deviceTypeId);
}

export function listDeviceTypes({ category }: { category?: DeviceType['category'] } = {}): DeviceType[] {
  const all = Array.from(registry.values());
  return category ? all.filter((m) => m.category === category) : all;
}

export function assertKnownDeviceType(deviceTypeId: string): void {
  if (!registry.has(deviceTypeId)) {
    const error = new Error(`Unknown device type: ${deviceTypeId}`) as Error & { code?: string };
    error.code = 'UNKNOWN_DEVICE_TYPE';
    throw error;
  }
}

export type ConnectionValidationResult =
  | { ok: true }
  | { ok: false; code: 'UNKNOWN_DEVICE_TYPE' | 'INVALID_CATEGORY_PAIR' | 'PROTOCOL_MISMATCH' | 'CAPACITY_EXCEEDED'; reason: string };

export function validateConnection(input: {
  sourceId: string;
  sourcePortId?: string;
  sourceCurrentChildren: number;
  targetId: string;
  targetPortId?: string;
  targetCurrentParents: number;
}): ConnectionValidationResult {
  const source = registry.get(input.sourceId);
  const target = registry.get(input.targetId);

  if (!source || !target) {
    return { ok: false, code: 'UNKNOWN_DEVICE_TYPE', reason: `Unknown device type in connection: source=${input.sourceId}, target=${input.targetId}` };
  }

  const outProtocols = sourceOutProtocols(source);
  const targetPort = input.targetPortId ? target.ports.find((p) => p.id === input.targetPortId) : undefined;
  const targetProtocolsAny = target.ports.flatMap((p) => p.acceptsProtocols);
  const hasSharedProtocol = outProtocols.some((p) => targetProtocolsAny.includes(p));

  if (!hasSharedProtocol) {
    return { ok: false, code: 'INVALID_CATEGORY_PAIR', reason: `No shared protocol families between ${source.id} and ${target.id}` };
  }

  if (input.targetPortId && (!targetPort || !targetPort.acceptsProtocols.some((p) => outProtocols.includes(p)))) {
    return { ok: false, code: 'PROTOCOL_MISMATCH', reason: `Target port ${input.targetPortId} does not accept source protocols` };
  }

  const sourcePort = input.sourcePortId ? source.ports.find((p) => p.id === input.sourcePortId) : undefined;
  if (sourcePort && input.sourceCurrentChildren + 1 > sourcePort.maxCount) {
    return { ok: false, code: 'CAPACITY_EXCEEDED', reason: `Source port ${sourcePort.id} capacity exceeded` };
  }
  if (targetPort && input.targetCurrentParents + 1 > targetPort.maxCount) {
    return { ok: false, code: 'CAPACITY_EXCEEDED', reason: `Target port ${targetPort.id} capacity exceeded` };
  }

  return { ok: true };
}

/** test-only helper */
export function __resetRegistryForTests(): void {
  registry.clear();
  registrationCallSite.clear();
}

import { BrokerDriverSchema, type BrokerDriverDef, type BrokerSupportedCapability } from './schema';

const registry = new Map<string, BrokerDriverDef>();
const registrationCallSite = new Map<string, string>();

function captureCaller(): string {
  const stack = new Error().stack ?? '';
  const lines = stack.split('\n');
  return lines[3]?.trim() ?? '<unknown>';
}

export function registerBrokerDriver(driver: unknown): BrokerDriverDef {
  const parsed = BrokerDriverSchema.parse(driver);
  if (registry.has(parsed.id)) {
    throw new Error(
      `Duplicate broker-driver id: ${parsed.id}. First registration: ${registrationCallSite.get(parsed.id)}`,
    );
  }
  registry.set(parsed.id, parsed);
  registrationCallSite.set(parsed.id, captureCaller());
  return parsed;
}

export function getBrokerDriver(id: string): BrokerDriverDef {
  const def = registry.get(id);
  if (!def) {
    const err = new Error(`Unknown broker-driver id: ${id}`);
    (err as Error & { code?: string }).code = 'UNKNOWN_BROKER_DRIVER';
    throw err;
  }
  return def;
}

export function listBrokerDrivers(opts?: { capability?: BrokerSupportedCapability }): BrokerDriverDef[] {
  const all = Array.from(registry.values());
  if (!opts?.capability) return all;
  const cap = opts.capability;
  return all.filter((d) => d.supportedSiteCapabilities.includes(cap));
}

/** Test-only: clear the registry between tests. */
export function __resetBrokerDriverRegistryForTests(): void {
  registry.clear();
  registrationCallSite.clear();
}

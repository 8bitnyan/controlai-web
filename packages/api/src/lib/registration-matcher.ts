import { listDeviceTypes, type DiscoveredChild, type MatchPlan, type RegistrationDecisions } from '@controlai-web/shared-types';

type MatcherDevice = {
  deviceKey: string;
  deviceTypeId: string;
  canvasNodeId: string;
  createdAt: Date;
  portBindings: unknown;
};

function firmwareToDeviceTypeId(firmwareTypeCode: string): string | null {
  const candidates = listDeviceTypes({ category: 'sensor' })
    .filter((m) => m.firmwareTypeIds.includes(firmwareTypeCode))
    .map((m) => m.id)
    .sort();
  if (candidates.length === 0) return null;
  if (candidates.length > 1) console.warn({ event: 'firmware-type-multiclaim', firmwareTypeCode, candidates });
  return candidates[0] ?? null;
}

export function proposeRegistrationMatch(shadows: MatcherDevice[], discovered: DiscoveredChild[], lastKnownDecisions?: RegistrationDecisions | null): MatchPlan {
  const unknownTypes = discovered.filter((d) => !firmwareToDeviceTypeId(d.firmwareTypeCode));
  const knownDiscovered = discovered.filter((d) => firmwareToDeviceTypeId(d.firmwareTypeCode));
  const sortedShadows = [...shadows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.deviceKey.localeCompare(b.deviceKey));
  const chosen = new Map<string, MatchPlan['confirmedMatches'][number]>();
  const claimed = new Set<string>();

  const claim = (shadow: MatcherDevice, child: DiscoveredChild, confidence: MatchPlan['confirmedMatches'][number]['confidence']): boolean => {
    if (chosen.has(shadow.deviceKey) || claimed.has(child.raw)) return false;
    const resolvedDeviceTypeId = firmwareToDeviceTypeId(child.firmwareTypeCode);
    if (!resolvedDeviceTypeId) return false;
    chosen.set(shadow.deviceKey, { shadowDeviceKey: shadow.deviceKey, discovered: child, confidence, resolvedDeviceTypeId, proposedPortBindings: { parentPortId: child.portId, address: child.address } });
    claimed.add(child.raw);
    return true;
  };

  for (const shadow of sortedShadows) for (const child of knownDiscovered) if (firmwareToDeviceTypeId(child.firmwareTypeCode) === shadow.deviceTypeId && claim(shadow, child, 'EXACT')) break;
  for (const shadow of sortedShadows) {
    if (chosen.has(shadow.deviceKey)) continue;
    const pb = (shadow.portBindings as { parentPortId?: string; address?: number } | null) ?? null;
    for (const child of knownDiscovered) if (!claimed.has(child.raw) && pb?.parentPortId === child.portId && pb?.address === child.address && claim(shadow, child, 'PORT_AND_ADDRESS')) break;
  }
  for (const shadow of sortedShadows) if (!chosen.has(shadow.deviceKey)) { const child = knownDiscovered.find((d) => !claimed.has(d.raw)); if (child) claim(shadow, child, 'ORDER_FALLBACK'); }
  for (const shadow of sortedShadows) if (!chosen.has(shadow.deviceKey)) { const child = knownDiscovered.find((d) => !claimed.has(d.raw) && (d.serialAscii ?? '').toLowerCase().includes(shadow.canvasNodeId.toLowerCase())); if (child) claim(shadow, child, 'LABEL_HEURISTIC'); }
  if (lastKnownDecisions) for (const m of lastKnownDecisions.confirmedMatches) { const s = sortedShadows.find((x) => x.deviceKey === m.shadowDeviceKey); const c = knownDiscovered.find((x) => x.raw === m.discoveredRaw); if (s && c) claim(s, c, 'LAST_KNOWN'); }

  return {
    confirmedMatches: sortedShadows.map((s) => chosen.get(s.deviceKey)).filter((m): m is MatchPlan['confirmedMatches'][number] => Boolean(m)),
    unmatchedShadows: sortedShadows.filter((s) => !chosen.has(s.deviceKey)).map((s) => ({ deviceKey: s.deviceKey, reason: 'no-confident-match' })),
    extras: knownDiscovered.filter((d) => !claimed.has(d.raw)),
    unknownTypes,
    gatewayMatch: { boardReportedUuid: '' },
  };
}

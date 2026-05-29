import { LRUCache } from 'lru-cache';
import { prisma } from '@controlai-web/db';
import { decode as cborDecode } from 'cbor-x';
import type { NormalizedMessage } from './normalized-message';

/**
 * Translates legacy `modules/{groupId}/{NBIRTH|NDATA|NDEATH}/{clientId}` topics
 * to NormalizedMessage by resolving Gateway.clientId → Gateway.deviceKey via Prisma.
 *
 * Caches lookups in an LRU (capacity 10_000, ttl 5 min).
 */

const LEGACY_TOPIC_RE = /^modules\/[^/]+\/(NBIRTH|NDATA|NDEATH)\/([^/]+)$/;

// LRU values are wrapped in a tuple so the type is non-nullish.
const clientIdToDeviceKey = new LRUCache<string, { deviceKey: string | null }>({
  max: 10_000,
  ttl: 5 * 60 * 1000,
});

const DATATYPE_MAP: Record<string, 'birth' | 'data' | 'death'> = {
  NBIRTH: 'birth',
  NDATA: 'data',
  NDEATH: 'death',
};

async function resolveDeviceKey(clientId: string): Promise<string | null> {
  const cached = clientIdToDeviceKey.get(clientId);
  if (cached) return cached.deviceKey;
  const gw = await prisma.gateway.findFirst({
    where: { clientId },
    select: { deviceKey: true },
  });
  const deviceKey = gw?.deviceKey ?? null;
  clientIdToDeviceKey.set(clientId, { deviceKey });
  return deviceKey;
}

function maybeDecodeCbor(payload: Buffer | Uint8Array): unknown {
  try {
    return cborDecode(payload);
  } catch {
    try {
      return JSON.parse(Buffer.from(payload).toString('utf-8'));
    } catch {
      return null;
    }
  }
}

export async function translateLegacyTopic(
  topic: string,
  payload: Buffer | Uint8Array,
  sourceDriver = 'mqtt-driver',
): Promise<NormalizedMessage | null> {
  const m = topic.match(LEGACY_TOPIC_RE);
  if (!m) return null;
  const [, msgType, clientId] = m;
  if (!msgType || !clientId) return null;
  const deviceKey = await resolveDeviceKey(clientId);
  if (!deviceKey) {
    // eslint-disable-next-line no-console
    console.warn(JSON.stringify({ event: 'topic-translator-unknown-clientId', clientId, topic }));
    return null;
  }
  const decoded = maybeDecodeCbor(payload);
  return {
    deviceKey,
    dataType: DATATYPE_MAP[msgType] ?? 'data',
    payload: decoded,
    ts: new Date().toISOString(),
    sourceTopic: topic,
    sourceDriver,
  };
}

export function formatNewTopic({
  siteId,
  deviceKey,
  dataType,
}: {
  siteId: string;
  deviceKey: string;
  dataType: 'birth' | 'data' | 'death' | 'cmd';
}): string {
  return `controlai/${siteId}/${deviceKey}/${dataType}`;
}

/** Test/runtime helper to invalidate the cache for a specific clientId (e.g. on gateway.update). */
export function invalidateClientIdCache(clientId: string): void {
  clientIdToDeviceKey.delete(clientId);
}

/** Test-only: clear the entire cache. */
export function __resetTopicTranslatorCacheForTests(): void {
  clientIdToDeviceKey.clear();
}

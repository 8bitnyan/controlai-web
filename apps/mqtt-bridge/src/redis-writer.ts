import Redis from 'ioredis';

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_URL) return null;

  if (!redis) {
    redis = new Redis(process.env.UPSTASH_REDIS_URL, {
      password: process.env.UPSTASH_REDIS_TOKEN,
      tls: process.env.UPSTASH_REDIS_URL.startsWith('rediss://') ? {} : undefined,
      lazyConnect: true,
    });

    redis.on('error', (err) => {
      console.error('[redis] connection error:', err.message);
    });
  }

  return redis;
}

/**
 * Write an MQTT message to an Upstash Redis Stream.
 * Key format: `<siteId>:<topic>`
 * Uses XADD with MAXLEN ~ 1000 to cap the stream.
 */
export async function writeMessage(
  siteId: string,
  topic: string,
  payload: unknown,
): Promise<void> {
  const r = getRedis();
  if (!r) return;

  const key = `${siteId}:${topic}`;
  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);

  try {
    await r.xadd(
      key,
      'MAXLEN',
      '~',
      1000,
      '*',
      'payload',
      payloadStr,
      'timestamp',
      new Date().toISOString(),
    );
  } catch (err) {
    console.error('[redis] XADD error:', err instanceof Error ? err.message : err);
  }
}

/**
 * Read messages from a Redis Stream for Last-Event-ID replay.
 */
export async function readMessagesAfter(
  siteId: string,
  topic: string,
  lastId: string,
  count = 100,
): Promise<Array<{ id: string; payload: string; timestamp: string }>> {
  const r = getRedis();
  if (!r) return [];

  const key = `${siteId}:${topic}`;

  try {
    const entries = await r.xrange(key, lastId, '+', 'COUNT', count);
    return entries
      .filter(([id]) => id !== lastId) // exclude the lastId itself
      .map(([id, fields]) => {
        const fieldMap: Record<string, string> = {};
        for (let i = 0; i < fields.length - 1; i += 2) {
          fieldMap[fields[i]!] = fields[i + 1]!;
        }
        return {
          id,
          payload: fieldMap.payload ?? '{}',
          timestamp: fieldMap.timestamp ?? new Date().toISOString(),
        };
      });
  } catch (err) {
    console.error('[redis] XRANGE error:', err instanceof Error ? err.message : err);
    return [];
  }
}

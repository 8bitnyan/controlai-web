import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encode as cborEncode } from 'cbor-x';

vi.mock('@controlai-web/db', () => ({
  prisma: {
    gateway: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from '@controlai-web/db';
import {
  translateLegacyTopic,
  formatNewTopic,
  invalidateClientIdCache,
  __resetTopicTranslatorCacheForTests,
} from '../topic-translator';

const findFirst = vi.mocked(prisma.gateway.findFirst);
const VALID_CUID = 'cklm1q2r3000a01abcdef1234';

beforeEach(() => {
  __resetTopicTranslatorCacheForTests();
  findFirst.mockReset();
});

describe('translateLegacyTopic', () => {
  it('translates NBIRTH topic to birth NormalizedMessage', async () => {
    findFirst.mockResolvedValueOnce({ deviceKey: VALID_CUID } as never);
    const payload = cborEncode({ ts: 123, vars: { a: 1 } });
    const msg = await translateLegacyTopic('modules/G1/NBIRTH/CLIENT-1', payload);
    expect(msg).not.toBeNull();
    expect(msg?.deviceKey).toBe(VALID_CUID);
    expect(msg?.dataType).toBe('birth');
    expect(msg?.sourceTopic).toBe('modules/G1/NBIRTH/CLIENT-1');
    expect(msg?.sourceDriver).toBe('mqtt-driver');
  });

  it('translates NDATA topic to data', async () => {
    findFirst.mockResolvedValueOnce({ deviceKey: VALID_CUID } as never);
    const payload = cborEncode({ v: 42 });
    const msg = await translateLegacyTopic('modules/G/NDATA/C', payload);
    expect(msg?.dataType).toBe('data');
  });

  it('translates NDEATH topic to death', async () => {
    findFirst.mockResolvedValueOnce({ deviceKey: VALID_CUID } as never);
    const msg = await translateLegacyTopic('modules/G/NDEATH/C', cborEncode({}));
    expect(msg?.dataType).toBe('death');
  });

  it('caches clientId lookups (no Prisma call on hit)', async () => {
    findFirst.mockResolvedValueOnce({ deviceKey: VALID_CUID } as never);
    const payload = cborEncode({ v: 1 });
    await translateLegacyTopic('modules/G/NDATA/CACHED', payload);
    await translateLegacyTopic('modules/G/NDATA/CACHED', payload);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('returns null + caches for unknown clientId', async () => {
    findFirst.mockResolvedValueOnce(null);
    const msg = await translateLegacyTopic('modules/G/NDATA/UNK', cborEncode({}));
    expect(msg).toBeNull();
    // Second call uses cache (still null) — Prisma not called again
    findFirst.mockClear();
    const msg2 = await translateLegacyTopic('modules/G/NDATA/UNK', cborEncode({}));
    expect(msg2).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('returns null for non-matching topic', async () => {
    const msg = await translateLegacyTopic('controlai/site/dev/data', Buffer.from('{}'));
    expect(msg).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('invalidateClientIdCache forces re-lookup', async () => {
    findFirst.mockResolvedValueOnce({ deviceKey: VALID_CUID } as never);
    await translateLegacyTopic('modules/G/NDATA/INV', cborEncode({}));
    invalidateClientIdCache('INV');
    findFirst.mockResolvedValueOnce({ deviceKey: VALID_CUID } as never);
    await translateLegacyTopic('modules/G/NDATA/INV', cborEncode({}));
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('decodes JSON fallback when payload is not CBOR', async () => {
    findFirst.mockResolvedValueOnce({ deviceKey: VALID_CUID } as never);
    const payload = Buffer.from(JSON.stringify({ value: 7 }));
    const msg = await translateLegacyTopic('modules/G/NDATA/J', payload);
    expect(msg?.payload).toEqual({ value: 7 });
  });
});

describe('formatNewTopic', () => {
  it('formats controlai/{siteId}/{deviceKey}/{dataType}', () => {
    expect(formatNewTopic({ siteId: 's1', deviceKey: 'dk1', dataType: 'data' })).toBe(
      'controlai/s1/dk1/data',
    );
  });
});

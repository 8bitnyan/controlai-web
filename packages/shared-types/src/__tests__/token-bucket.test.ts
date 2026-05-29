import { describe, expect, it, vi } from 'vitest';
import { TokenBucket } from '../token-bucket';

describe('TokenBucket', () => {
  it('starts full and allows capacity acquires immediately', async () => {
    const bucket = new TokenBucket({ capacity: 3, refillPerSec: 1 });
    await expect(bucket.acquire()).resolves.toBeUndefined();
    await expect(bucket.acquire()).resolves.toBeUndefined();
    await expect(bucket.acquire()).resolves.toBeUndefined();
  });

  it('queues beyond capacity and releases on refill cadence', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    try {
      const bucket = new TokenBucket({ capacity: 2, refillPerSec: 2 });
      await bucket.acquire();
      await bucket.acquire();

      let released = false;
      const pending = bucket.acquire().then(() => {
        released = true;
      });

      await vi.advanceTimersByTimeAsync(499);
      expect(released).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(released).toBe(true);
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });

  it('never exceeds capacity after long idle', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    try {
      const bucket = new TokenBucket({ capacity: 2, refillPerSec: 1 });
      await bucket.acquire();
      await bucket.acquire();

      await vi.advanceTimersByTimeAsync(10_000);

      await bucket.acquire();
      await bucket.acquire();

      let thirdResolved = false;
      const third = bucket.acquire().then(() => {
        thirdResolved = true;
      });

      await vi.advanceTimersByTimeAsync(999);
      expect(thirdResolved).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(thirdResolved).toBe(true);
      await third;
    } finally {
      vi.useRealTimers();
    }
  });

  it('serves concurrent queued acquires in FIFO order', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    try {
      const bucket = new TokenBucket({ capacity: 1, refillPerSec: 1 });
      await bucket.acquire();

      const order: string[] = [];
      const p1 = bucket.acquire().then(() => order.push('first'));
      const p2 = bucket.acquire().then(() => order.push('second'));
      const p3 = bucket.acquire().then(() => order.push('third'));

      await vi.advanceTimersByTimeAsync(1000);
      expect(order).toEqual(['first']);

      await vi.advanceTimersByTimeAsync(1000);
      expect(order).toEqual(['first', 'second']);

      await vi.advanceTimersByTimeAsync(1000);
      expect(order).toEqual(['first', 'second', 'third']);

      await Promise.all([p1, p2, p3]);
    } finally {
      vi.useRealTimers();
    }
  });
});

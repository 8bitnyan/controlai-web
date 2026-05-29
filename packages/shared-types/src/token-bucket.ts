type TokenBucketOptions = {
  capacity: number;
  refillPerSec: number;
};

type QueueItem = {
  resolve: () => void;
};

export class TokenBucket {
  private readonly capacity: number;
  private readonly refillPerSec: number;
  private tokens: number;
  private lastRefillAt: number;
  private queue: QueueItem[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor({ capacity, refillPerSec }: TokenBucketOptions) {
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new Error('TokenBucket capacity must be > 0');
    }
    if (!Number.isFinite(refillPerSec) || refillPerSec <= 0) {
      throw new Error('TokenBucket refillPerSec must be > 0');
    }

    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.tokens = capacity;
    this.lastRefillAt = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();

    if (this.queue.length === 0 && this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push({ resolve });
      this.pumpQueue();
    });
  }

  private refill(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastRefillAt;

    if (elapsedMs <= 0) {
      return;
    }

    const refillAmount = (elapsedMs / 1000) * this.refillPerSec;
    this.tokens = Math.min(this.capacity, this.tokens + refillAmount);
    this.lastRefillAt = now;
  }

  private pumpQueue(): void {
    this.refill();

    while (this.queue.length > 0 && this.tokens >= 1) {
      this.tokens -= 1;
      const next = this.queue.shift();
      next?.resolve();
    }

    if (this.queue.length === 0) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      return;
    }

    const waitMs = Math.max(0, ((1 - this.tokens) / this.refillPerSec) * 1000);
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pumpQueue();
    }, waitMs);
  }
}

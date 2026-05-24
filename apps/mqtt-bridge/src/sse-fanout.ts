import { EventEmitter } from 'events';

export type SseMessageHandler = (message: string) => void;

/**
 * In-process EventEmitter-based SSE fanout.
 * One MQTT subscriber per site fans out to N SSE clients.
 */
class SseFanout extends EventEmitter {
  /** Map<siteId, Set<handler>> — tracks subscriber counts per site */
  private readonly siteSubscribers = new Map<string, Set<SseMessageHandler>>();

  subscribe(siteId: string, handler: SseMessageHandler): void {
    if (!this.siteSubscribers.has(siteId)) {
      this.siteSubscribers.set(siteId, new Set());
    }
    this.siteSubscribers.get(siteId)!.add(handler);
    this.on(`msg:${siteId}`, handler);
  }

  unsubscribe(siteId: string, handler: SseMessageHandler): void {
    this.off(`msg:${siteId}`, handler);
    const set = this.siteSubscribers.get(siteId);
    if (set) {
      set.delete(handler);
      if (set.size === 0) {
        this.siteSubscribers.delete(siteId);
      }
    }
  }

  emit(siteId: string, message: string): boolean;
  emit(eventName: string | symbol, ...args: unknown[]): boolean;
  emit(siteIdOrEvent: string | symbol, ...args: unknown[]): boolean {
    if (typeof siteIdOrEvent === 'string' && !siteIdOrEvent.startsWith('msg:')) {
      return super.emit(`msg:${siteIdOrEvent}`, args[0]);
    }
    return super.emit(siteIdOrEvent, ...args);
  }

  /** Number of SSE clients subscribed to a site */
  subscriberCount(siteId: string): number {
    return this.siteSubscribers.get(siteId)?.size ?? 0;
  }

  /** All sites with at least 1 subscriber */
  activeSiteIds(): string[] {
    return [...this.siteSubscribers.keys()];
  }
}

export const sseFanout = new SseFanout();
sseFanout.setMaxListeners(200); // up to 200 concurrent SSE clients

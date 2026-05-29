'use client';

import { useEffect, useRef } from 'react';
import { trpc } from '@/lib/trpc/client';
type SiteGroupInboundEvent = { topic: string; msgType: string; clientId: string; ts: number; payloadSummary: string; readings?: Array<{ sensorId: string; value: number; ts: number }>; source: 'sim' | 'board' };

export function useSiteGroupInbound({ orgId, siteGroupId, enabled = true, onMessage, onStatusChange }: { orgId: string; siteGroupId: string; enabled?: boolean; onMessage?: (msg: SiteGroupInboundEvent) => void; onStatusChange?: (s: 'disconnected' | 'connecting' | 'connected' | 'error') => void }) {
  const esRef = useRef<EventSource | null>(null);
  const reconnectDelayRef = useRef(1000);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenMutation = trpc.stream.siteGroupToken.useMutation({
    onSuccess: ({ token, streamUrl }) => {
      esRef.current?.close();
      onStatusChange?.('connecting');
      const es = new EventSource(`${streamUrl}?token=${encodeURIComponent(token)}`);
      esRef.current = es;
      es.onopen = () => { reconnectDelayRef.current = 1000; onStatusChange?.('connected'); };
      es.onmessage = (event) => { try { onMessage?.(JSON.parse(event.data) as SiteGroupInboundEvent); } catch {} };
      es.onerror = () => {
        onStatusChange?.('error');
        es.close();
        const delay = reconnectDelayRef.current;
        reconnectDelayRef.current = Math.min(delay * 2, 30_000);
        reconnectTimerRef.current = setTimeout(() => tokenMutation.mutate({ orgId, siteGroupId }), delay);
      };
    },
  });
  useEffect(() => {
    if (!enabled || !siteGroupId) return;
    tokenMutation.mutate({ orgId, siteGroupId });
    return () => { esRef.current?.close(); if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current); onStatusChange?.('disconnected'); };
  }, [enabled, orgId, siteGroupId]);
}

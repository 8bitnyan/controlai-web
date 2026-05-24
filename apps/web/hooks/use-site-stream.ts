'use client';

import { useEffect, useRef } from 'react';
import { trpc } from '@/lib/trpc/client';
import type { TelemetryMessage } from '@controlai-web/shared-types';

interface UseSiteStreamOptions {
  orgId: string;
  siteId: string;
  enabled?: boolean;
  onMessage?: (msg: TelemetryMessage) => void;
  onStatusChange?: (status: 'disconnected' | 'connecting' | 'connected' | 'error') => void;
}

const REFRESH_BUFFER_S = 30; // refresh token 30s before expiry

export function useSiteStream({
  orgId,
  siteId,
  enabled = true,
  onMessage,
  onStatusChange,
}: UseSiteStreamOptions) {
  const esRef = useRef<EventSource | null>(null);
  const tokenDataRef = useRef<{ token: string; expiresAt: string; streamUrl: string } | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(1000);

  const tokenMutation = trpc.stream.token.useMutation({
    onSuccess: (data) => {
      tokenDataRef.current = data;
      openStream(data.token, data.streamUrl, data.expiresAt);
    },
  });

  function scheduleTokenRefresh(expiresAt: string) {
    const expMs = new Date(expiresAt).getTime();
    const refreshAt = expMs - REFRESH_BUFFER_S * 1000;
    const delay = Math.max(0, refreshAt - Date.now());

    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      tokenMutation.mutate({ orgId, siteId });
    }, delay);
  }

  function openStream(token: string, streamUrl: string, expiresAt: string) {
    closeStream();
    onStatusChange?.('connecting');

    const url = `${streamUrl}?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      reconnectDelayRef.current = 1000;
      onStatusChange?.('connected');
    };

    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as TelemetryMessage;
        onMessage?.(msg);
      } catch {
        // ignore malformed events
      }
    };

    es.onerror = () => {
      onStatusChange?.('error');
      closeStream();
      // Exponential backoff reconnect
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(delay * 2, 30_000);

      reconnectTimerRef.current = setTimeout(() => {
        // Re-fetch token on reconnect
        tokenMutation.mutate({ orgId, siteId });
      }, delay);
    };

    scheduleTokenRefresh(expiresAt);
  }

  function closeStream() {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }

  useEffect(() => {
    if (!enabled || !siteId) return;

    tokenMutation.mutate({ orgId, siteId });

    return () => {
      closeStream();
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      onStatusChange?.('disconnected');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, siteId, orgId]);
}

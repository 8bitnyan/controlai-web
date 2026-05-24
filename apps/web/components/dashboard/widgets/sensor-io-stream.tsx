'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { trpc } from '@/lib/trpc/client';
import type { GatewayDTO } from '@controlai-web/shared-types';
import { Badge } from '@/components/ui/badge';

interface Message {
  id: string;
  ts: number;
  topic: string;
  summary: string;
}

interface SensorIoStreamProps {
  orgId: string;
  siteGroupId: string;
}

const MAX_MESSAGES = 100;
const FLUSH_INTERVAL_MS = 200; // 5 Hz DOM update throttle

/**
 * Throttled list appender — buffers incoming messages and flushes at 5 Hz.
 */
function useThrottledListAppender(): [Message[], (msg: Message) => void] {
  const [messages, setMessages] = useState<Message[]>([]);
  const buffer = useRef<Message[]>([]);
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    flushTimer.current = setInterval(() => {
      if (buffer.current.length === 0) return;
      const incoming = buffer.current.splice(0);
      setMessages((prev) => {
        const next = [...prev, ...incoming];
        return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
      });
    }, FLUSH_INTERVAL_MS);
    return () => {
      if (flushTimer.current) clearInterval(flushTimer.current);
    };
  }, []);

  const append = useCallback((msg: Message) => {
    buffer.current.push(msg);
  }, []);

  return [messages, append];
}

function ConnectionPill({ status }: { status: 'connecting' | 'connected' | 'error' | 'closed' }) {
  const variant =
    status === 'connected' ? 'default' : status === 'error' ? 'destructive' : 'secondary';
  return <Badge variant={variant} className="text-xs">{status}</Badge>;
}

interface PaneProps {
  title: string;
  messages: Message[];
  connStatus: 'connecting' | 'connected' | 'error' | 'closed';
  picker: React.ReactNode;
}

function MessagePane({ title, messages, connStatus, picker }: PaneProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="flex items-center gap-2 mb-2 shrink-0">
        <span className="text-xs font-semibold text-muted-foreground">{title}</span>
        <ConnectionPill status={connStatus} />
        <div className="flex-1">{picker}</div>
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto text-xs font-mono space-y-0.5">
        {messages.length === 0 ? (
          <div className="text-muted-foreground py-2 text-center">No messages yet</div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="flex gap-2 hover:bg-muted/30 rounded px-1">
              <span className="text-muted-foreground shrink-0 w-20">
                {new Date(m.ts).toLocaleTimeString()}
              </span>
              <span className="text-muted-foreground shrink-0 truncate max-w-[120px]" title={m.topic}>
                {m.topic}
              </span>
              <span className="truncate text-foreground">{m.summary}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function GatewayPicker({
  gateways,
  value,
  onChange,
}: {
  gateways: GatewayDTO[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-6 w-full rounded border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <option value="">— pick gateway —</option>
      {gateways.map((g) => (
        <option key={g.id} value={g.id}>
          {g.label}
        </option>
      ))}
    </select>
  );
}

export function SensorIoStream({ orgId, siteGroupId }: SensorIoStreamProps) {
  const { data: gateways } = trpc.gateway.list.useQuery(
    { orgId, siteGroupId },
    { refetchInterval: 10_000 },
  );
  const gwList = gateways ?? [];

  // Outbound (simulator → broker)
  const [outboundGwId, setOutboundGwId] = useState('');
  const [outboxMessages, appendOutbox] = useThrottledListAppender();
  const [outboxConn, setOutboxConn] = useState<'connecting' | 'connected' | 'error' | 'closed'>('closed');

  // Inbound (broker → mqtt-bridge → SSE)
  const [inboundGwId, setInboundGwId] = useState('');
  const [inboundMessages, appendInbound] = useThrottledListAppender();
  const [inboundConn, setInboundConn] = useState<'connecting' | 'connected' | 'error' | 'closed'>('closed');

  const streamTokenMutation = trpc.gateway.streamToken.useMutation();

  // Open outbox SSE when outboundGwId changes
  const outboxEsRef = useRef<EventSource | null>(null);
  useEffect(() => {
    if (outboxEsRef.current) {
      outboxEsRef.current.close();
      outboxEsRef.current = null;
      setOutboxConn('closed');
    }
    if (!outboundGwId) return;

    setOutboxConn('connecting');

    streamTokenMutation.mutate(
      { orgId, gatewayId: outboundGwId },
      {
        onSuccess: ({ token, outboxUrl }) => {
          const es = new EventSource(`${outboxUrl}?token=${encodeURIComponent(token)}`);
          outboxEsRef.current = es;

          es.onopen = () => setOutboxConn('connected');
          es.onerror = () => setOutboxConn('error');
          es.onmessage = (e: MessageEvent<string>) => {
            try {
              const data = JSON.parse(e.data) as {
                type: string;
                topic?: string;
                payloadSummary?: string;
                ts?: number;
              };
              if (data.type === 'outbox' && data.topic) {
                appendOutbox({
                  id: crypto.randomUUID(),
                  ts: data.ts ?? Date.now(),
                  topic: data.topic,
                  summary: data.payloadSummary ?? '',
                });
              }
            } catch {
              // ignore malformed
            }
          };
        },
        onError: () => setOutboxConn('error'),
      },
    );

    return () => {
      outboxEsRef.current?.close();
      outboxEsRef.current = null;
      setOutboxConn('closed');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outboundGwId]);

  // Inbound: subscribe to the stream token for siteId='' as a bridge stream
  // We filter the bridge SSE by the selected gateway's topic prefix.
  // For now, obtain a stream token for the first site in the siteGroup (best effort).
  const inboundGw = gwList.find((g) => g.id === inboundGwId);
  const siteStreamTokenMutation = trpc.stream.token.useMutation();
  const inboundEsRef = useRef<EventSource | null>(null);

  // We need a siteId to open the bridge stream.
  const { data: sitesData } = trpc.site.list.useQuery(
    { orgId, siteGroupId },
    { enabled: !!inboundGwId },
  );

  const firstSiteId = sitesData?.[0]?.id;

  useEffect(() => {
    if (inboundEsRef.current) {
      inboundEsRef.current.close();
      inboundEsRef.current = null;
      setInboundConn('closed');
    }
    if (!inboundGwId || !firstSiteId) return;

    setInboundConn('connecting');

    siteStreamTokenMutation.mutate(
      { orgId, siteId: firstSiteId },
      {
        onSuccess: ({ token, streamUrl }) => {
          const es = new EventSource(`${streamUrl}?token=${encodeURIComponent(token)}`);
          inboundEsRef.current = es;

          es.onopen = () => setInboundConn('connected');
          es.onerror = () => setInboundConn('error');
          es.onmessage = (e: MessageEvent<string>) => {
            try {
              const data = JSON.parse(e.data) as {
                topic?: string;
                payload?: unknown;
                timestamp?: string;
              };
              if (!data.topic) return;

              // Filter by gateway topic prefix
              const topicPrefix =
                inboundGw?.mode === 'cbor-modules-cloud'
                  ? `modules/${inboundGw.groupId}/`
                  : inboundGw?.jsonTopicTemplate
                    ? inboundGw.jsonTopicTemplate.split('{')[0]
                    : '';

              if (topicPrefix && !data.topic.startsWith(topicPrefix)) return;

              const summary =
                typeof data.payload === 'object' && data.payload !== null
                  ? JSON.stringify(data.payload).slice(0, 80)
                  : String(data.payload ?? '').slice(0, 80);

              appendInbound({
                id: crypto.randomUUID(),
                ts: data.timestamp ? new Date(data.timestamp).getTime() : Date.now(),
                topic: data.topic,
                summary,
              });
            } catch {
              // ignore
            }
          };
        },
        onError: () => setInboundConn('error'),
      },
    );

    return () => {
      inboundEsRef.current?.close();
      inboundEsRef.current = null;
      setInboundConn('closed');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inboundGwId, firstSiteId]);

  return (
    <div className="flex h-full gap-3">
      <div className="flex-1 min-w-0">
        <MessagePane
          title="Outbound (Simulator → Broker)"
          messages={outboxMessages}
          connStatus={outboxConn}
          picker={
            <GatewayPicker
              gateways={gwList}
              value={outboundGwId}
              onChange={setOutboundGwId}
            />
          }
        />
      </div>
      <div className="w-px bg-border shrink-0" />
      <div className="flex-1 min-w-0">
        <MessagePane
          title="Inbound (Broker → Bridge)"
          messages={inboundMessages}
          connStatus={inboundConn}
          picker={
            <GatewayPicker
              gateways={gwList}
              value={inboundGwId}
              onChange={setInboundGwId}
            />
          }
        />
      </div>
    </div>
  );
}

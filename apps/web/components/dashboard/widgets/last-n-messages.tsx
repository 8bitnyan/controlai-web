'use client';

import { useEffect } from 'react';
import { trpc } from '@/lib/trpc/client';

interface LastNMessagesProps {
  orgId: string;
  siteId: string;
  n?: number;
}

export function LastNMessages({ orgId, siteId, n = 50 }: LastNMessagesProps) {
  const { data, refetch, isLoading } = trpc.telemetry.recent.useQuery(
    { orgId, siteId, n },
    { refetchOnWindowFocus: false },
  );

  // Poll every 10s when tab is visible
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refetch();
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, [refetch]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  const messages = data?.messages ?? [];

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No messages yet
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-background">
          <tr className="border-b">
            <th className="py-1 pr-3 text-left font-medium text-muted-foreground w-32">Time</th>
            <th className="py-1 pr-3 text-left font-medium text-muted-foreground w-36">Topic</th>
            <th className="py-1 text-left font-medium text-muted-foreground">Payload</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {messages.map((msg) => (
            <tr key={msg.id} className="hover:bg-muted/20">
              <td className="py-1 pr-3 font-mono text-muted-foreground whitespace-nowrap">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </td>
              <td className="py-1 pr-3 truncate max-w-[144px] font-mono" title={msg.topic}>
                {msg.topic}
              </td>
              <td className="py-1 font-mono text-[10px] truncate max-w-[160px]" title={JSON.stringify(msg.payload)}>
                {typeof msg.payload === 'string'
                  ? msg.payload
                  : JSON.stringify(msg.payload)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

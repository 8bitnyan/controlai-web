'use client';
import { useMemo, useState } from 'react';
import { useSiteGroupInbound } from '@/hooks/use-sitegroup-inbound';

export function LiveBrokerLog({ orgId, siteGroupId }: { orgId: string; siteGroupId: string }) {
  const [rows, setRows] = useState<Array<{ ts: number; source: string; clientId: string; msgType: string; sensorId?: string; value?: number; topic: string }>>([]);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error' | 'disconnected'>('disconnected');
  useSiteGroupInbound({ orgId, siteGroupId, enabled: true, onStatusChange: setStatus, onMessage: (msg) => {
    const next = (msg.readings?.length ? msg.readings.map((r: { sensorId: string; value: number }) => ({ ts: msg.ts, source: msg.source, clientId: msg.clientId, msgType: msg.msgType, sensorId: r.sensorId, value: r.value, topic: msg.topic })) : [{ ts: msg.ts, source: msg.source, clientId: msg.clientId, msgType: msg.msgType, topic: msg.topic }]);
    setRows((prev) => [...next, ...prev].slice(0, 200));
  } });
  const tableRows = useMemo(() => rows, [rows]);
  return <div className="rounded-lg border p-3"><div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">Live Broker Log</h3><span className="text-xs text-muted-foreground">{status}</span></div><div className="max-h-80 overflow-auto"><table className="w-full text-xs"><thead><tr><th>time</th><th>source</th><th>clientId</th><th>msgType</th><th>sensorId</th><th>value</th><th>topic</th></tr></thead><tbody>{tableRows.map((r, i) => <tr key={`${r.ts}-${i}`}><td>{new Date(r.ts).toLocaleTimeString()}</td><td>{r.source}</td><td>{r.clientId}</td><td>{r.msgType}</td><td>{r.sensorId ?? '—'}</td><td>{typeof r.value === 'number' ? r.value.toFixed(3) : '—'}</td><td className="font-mono">{r.topic}</td></tr>)}</tbody></table></div></div>;
}

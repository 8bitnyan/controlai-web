'use client';
import { useMemo, useState } from 'react';
import { useSiteGroupInbound } from '@/hooks/use-sitegroup-inbound';

type Row = {
  ts: number;
  source: string;
  clientId: string;
  msgType: string;
  sensorId?: string;
  value?: number;
  topic: string;
};

const ALL_MSG_TYPES = ['NBIRTH', 'NDATA', 'NDEATH', 'DBIRTH', 'DDATA', 'DDEATH'] as const;
const ALL_SOURCES = ['sim', 'board'] as const;

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-muted-foreground hover:bg-muted'
      }`}
    >
      {children}
    </button>
  );
}

export function LiveBrokerLog({ orgId, siteGroupId }: { orgId: string; siteGroupId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error' | 'disconnected'>(
    'disconnected',
  );
  const [sources, setSources] = useState<Set<string>>(new Set(ALL_SOURCES));
  const [msgTypes, setMsgTypes] = useState<Set<string>>(new Set(ALL_MSG_TYPES));
  const [clientFilter, setClientFilter] = useState<string>('');
  const [sensorFilter, setSensorFilter] = useState<string>('');

  useSiteGroupInbound({
    orgId,
    siteGroupId,
    enabled: true,
    onStatusChange: setStatus,
    onMessage: (msg) => {
      const next: Row[] = msg.readings?.length
        ? msg.readings.map((r: { sensorId: string; value: number }) => ({
            ts: msg.ts,
            source: msg.source,
            clientId: msg.clientId,
            msgType: msg.msgType,
            sensorId: r.sensorId,
            value: r.value,
            topic: msg.topic,
          }))
        : [
            {
              ts: msg.ts,
              source: msg.source,
              clientId: msg.clientId,
              msgType: msg.msgType,
              topic: msg.topic,
            },
          ];
      setRows((prev) => [...next, ...prev].slice(0, 500));
    },
  });

  const distinctClientIds = useMemo(
    () => Array.from(new Set(rows.map((r) => r.clientId))).sort(),
    [rows],
  );
  const distinctSensorIds = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.sensorId).filter((v): v is string => Boolean(v)))).sort(),
    [rows],
  );

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (!sources.has(r.source)) return false;
        if (!msgTypes.has(r.msgType)) return false;
        if (clientFilter && r.clientId !== clientFilter) return false;
        if (sensorFilter && r.sensorId !== sensorFilter) return false;
        return true;
      }),
    [rows, sources, msgTypes, clientFilter, sensorFilter],
  );

  const toggle = (set: Set<string>, value: string, apply: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    apply(next);
  };

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold">Live Broker Log</h3>
        <span className="text-xs text-muted-foreground">
          {status} · {filtered.length}/{rows.length}
        </span>
      </div>

      <div className="mb-3 flex flex-col gap-2 border-b pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium text-muted-foreground w-16">Source</span>
          {ALL_SOURCES.map((s) => (
            <Chip
              key={s}
              active={sources.has(s)}
              onClick={() => toggle(sources, s, setSources)}
            >
              {s}
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium text-muted-foreground w-16">Type</span>
          {ALL_MSG_TYPES.map((t) => (
            <Chip
              key={t}
              active={msgTypes.has(t)}
              onClick={() => toggle(msgTypes, t, setMsgTypes)}
            >
              {t}
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[11px]">
            <span className="font-medium text-muted-foreground w-16">Gateway</span>
            <select
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              className="rounded border bg-background px-2 py-1 text-[11px] max-w-[18rem]"
            >
              <option value="">All ({distinctClientIds.length})</option>
              {distinctClientIds.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-[11px]">
            <span className="font-medium text-muted-foreground">Sensor</span>
            <select
              value={sensorFilter}
              onChange={(e) => setSensorFilter(e.target.value)}
              className="rounded border bg-background px-2 py-1 text-[11px] max-w-[18rem]"
            >
              <option value="">All ({distinctSensorIds.length})</option>
              {distinctSensorIds.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="max-h-80 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-background">
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-2">time</th>
              <th className="py-1 pr-2">source</th>
              <th className="py-1 pr-2">clientId</th>
              <th className="py-1 pr-2">msgType</th>
              <th className="py-1 pr-2">sensorId</th>
              <th className="py-1 pr-2">value</th>
              <th className="py-1">topic</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={`${r.ts}-${i}`} className="border-t">
                <td className="py-1 pr-2 tabular-nums">
                  {new Date(r.ts).toLocaleTimeString()}
                </td>
                <td className="py-1 pr-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                      r.source === 'board'
                        ? 'bg-emerald-500/15 text-emerald-600'
                        : 'bg-sky-500/15 text-sky-600'
                    }`}
                  >
                    {r.source}
                  </span>
                </td>
                <td className="py-1 pr-2 font-mono">{r.clientId}</td>
                <td className="py-1 pr-2">{r.msgType}</td>
                <td className="py-1 pr-2 font-mono">{r.sensorId ?? '—'}</td>
                <td className="py-1 pr-2 tabular-nums">
                  {typeof r.value === 'number' ? r.value.toFixed(3) : '—'}
                </td>
                <td className="py-1 font-mono text-muted-foreground truncate max-w-[20rem]">
                  {r.topic}
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-4 text-center text-muted-foreground">
                  {rows.length === 0 ? 'Waiting for messages…' : 'No messages match filters.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

'use client';

import { useState, useRef, useEffect } from 'react';
import ReactECharts from 'echarts-for-react';
import { trpc } from '@/lib/trpc/client';
import type { TelemetryMessage } from '@controlai-web/shared-types';

interface MsgRateChartProps {
  orgId: string;
  siteId: string;
  latestMessage?: TelemetryMessage;
}

type TimeWindow = '1h' | '6h' | '24h' | '7d';

const MAX_POINTS = 120; // 2 min at 1Hz

export function MsgRateChart({ orgId, siteId, latestMessage }: MsgRateChartProps) {
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('1h');
  const seriesDataRef = useRef<Record<string, Array<[number, number]>>>({});
  const [, forceUpdate] = useState(0);

  // Real-time SSE data — update at max 2 Hz
  const lastUpdateRef = useRef(0);
  useEffect(() => {
    if (!latestMessage?.nodeId || latestMessage.msgPerSec === undefined) return;
    const now = Date.now();
    if (now - lastUpdateRef.current < 500) return; // 2 Hz max
    lastUpdateRef.current = now;

    const nodeId = latestMessage.nodeId;
    if (!seriesDataRef.current[nodeId]) seriesDataRef.current[nodeId] = [];
    const series = seriesDataRef.current[nodeId]!;
    series.push([now, latestMessage.msgPerSec]);
    if (series.length > MAX_POINTS) series.shift();
    forceUpdate((v) => v + 1);
  }, [latestMessage]);

  // Backfill from TimescaleDB for windows > 1h
  const { data: rangeData } = trpc.telemetry.range.useQuery(
    {
      orgId,
      siteId,
      start: new Date(Date.now() - windowToMs(timeWindow)).toISOString(),
      end: new Date().toISOString(),
    },
    { enabled: timeWindow !== '1h' },
  );

  // For windows > 1h, use backfill data; otherwise use live SSE data
  const series = timeWindow !== '1h' && rangeData?.rows && rangeData.rows.length > 0
    ? Object.entries(
        (rangeData.rows as Array<Record<string, unknown>>).reduce<Record<string, Array<[number, number]>>>(
          (acc, row) => {
            const key = (row.nodeId as string | undefined) ?? 'all';
            if (!acc[key]) acc[key] = [];
            acc[key]!.push([
              new Date((row.timestamp as string | undefined) ?? Date.now()).getTime(),
              Number((row.msgPerSec as number | undefined) ?? 0),
            ]);
            return acc;
          },
          {},
        ),
      ).map(([nodeId, data]) => ({
        name: nodeId,
        type: 'line' as const,
        smooth: true,
        showSymbol: false,
        data,
      }))
    : Object.entries(seriesDataRef.current).map(([nodeId, data]) => ({
        name: nodeId,
        type: 'line' as const,
        smooth: true,
        showSymbol: false,
        data,
      }));

  const option = {
    tooltip: { trigger: 'axis', formatter: (p: unknown[]) => formatTooltip(p) },
    xAxis: { type: 'time', axisLabel: { formatter: '{HH}:{mm}' } },
    yAxis: { type: 'value', name: 'msg/s', minInterval: 1 },
    series,
    grid: { top: 30, bottom: 30, left: 50, right: 10 },
    legend: { type: 'scroll', bottom: 0 },
  };

  return (
    <div className="flex h-full flex-col gap-2">
      {/* Time window selector */}
      <div className="flex gap-1">
        {(['1h', '6h', '24h', '7d'] as TimeWindow[]).map((w) => (
          <button
            key={w}
            onClick={() => setTimeWindow(w)}
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              timeWindow === w
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {w}
          </button>
        ))}
      </div>
      <div className="flex-1">
        <ReactECharts
          option={option}
          style={{ height: '100%', width: '100%' }}
          notMerge={false}
          lazyUpdate
        />
      </div>
    </div>
  );
}

function windowToMs(w: TimeWindow): number {
  const map: Record<TimeWindow, number> = {
    '1h': 3600_000,
    '6h': 6 * 3600_000,
    '24h': 24 * 3600_000,
    '7d': 7 * 24 * 3600_000,
  };
  return map[w];
}

function formatTooltip(params: unknown[]): string {
  if (!Array.isArray(params) || params.length === 0) return '';
  const p = params[0] as { seriesName: string; value: [number, number] };
  return `${p.seriesName}: ${p.value[1]} msg/s`;
}

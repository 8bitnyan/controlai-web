'use client';

import ReactECharts from 'echarts-for-react';
import { trpc } from '@/lib/trpc/client';
import { Link } from 'lucide-react';
import NextLink from 'next/link';

interface CapacityGaugeProps {
  orgId: string;
  instanceId: string;
}

export function CapacityGauge({ orgId, instanceId }: CapacityGaugeProps) {
  const { data: instance } = trpc.instance.get.useQuery(
    { orgId, instanceId },
    { refetchInterval: 60_000 },
  );

  if (!instance) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  const isUnreachable = instance.status === 'UNREACHABLE';

  if (isUnreachable) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <div className="rounded-full bg-gray-100 p-4">
          <span className="text-3xl">⚠️</span>
        </div>
        <p className="text-sm text-muted-foreground font-medium">Unreachable</p>
      </div>
    );
  }

  const used = instance.capacityUsedMB ?? 0;
  const allowed = instance.capacityAllowedMB ?? 1;
  const pct = Math.min(100, Math.round((used / allowed) * 100));

  const color = pct < 60 ? '#22c55e' : pct < 85 ? '#eab308' : '#ef4444';

  const option = {
    series: [
      {
        type: 'gauge',
        startAngle: 180,
        endAngle: 0,
        min: 0,
        max: 100,
        radius: '90%',
        pointer: { show: false },
        progress: { show: true, width: 16, itemStyle: { color } },
        axisLine: { lineStyle: { width: 16 } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        detail: {
          fontSize: 20,
          fontWeight: 'bold',
          color,
          formatter: `{value}%`,
          offsetCenter: [0, '10%'],
        },
        data: [{ value: pct, name: `${used} / ${allowed} MB` }],
        title: { fontSize: 12, color: '#888', offsetCenter: [0, '40%'] },
      },
    ],
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1">
        <ReactECharts option={option} style={{ height: '100%', width: '100%' }} />
      </div>
      <div className="flex justify-center pb-1">
        <NextLink
          href={`/orgs/${orgId}/instances`}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Link className="h-3 w-3" />
          View instance
        </NextLink>
      </div>
    </div>
  );
}

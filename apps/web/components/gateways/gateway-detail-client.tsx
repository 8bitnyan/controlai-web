'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface GatewayDetailClientProps {
  gatewayId: string;
  orgId: string;
  projectId: string;
  siteGroupId: string;
}

export function GatewayDetailClient({
  gatewayId,
  orgId,
  projectId,
  siteGroupId,
}: GatewayDetailClientProps) {
  const q = trpc.gateway.get.useQuery({ orgId, gatewayId });

  if (q.isLoading) return <div className="p-6">불러오는 중...</div>;
  if (!q.data) return <div className="p-6">찾을 수 없습니다</div>;

  const gw = q.data;
  const provisionHref = `/orgs/${orgId}/projects/${projectId}/site-groups/${siteGroupId}/gateways/${gatewayId}/provision`;

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">{gw.label}</h1>

      <Card className="space-y-3 p-6">
        <Row label="종류" value={gw.kind} />
        <Row label="모드" value={gw.mode} />
        <Row label="브로커" value={gw.endpointURL} />
        <Row label="Group ID" value={gw.groupId} />
        <Row
          label="상태"
          value={
            <span className="flex items-center gap-2">
              <Badge>{gw.desiredState}</Badge>
              <Badge variant="outline">{gw.lastStatus}</Badge>
            </span>
          }
        />
        <Row
          label="인증서"
          value={
            <Badge variant={gw.hasCerts ? 'default' : 'destructive'}>
              {gw.hasCerts ? '발급됨' : '미발급'}
            </Badge>
          }
        />
      </Card>

      <div className="flex gap-3">
        {gw.hasCerts ? (
          <Link href={provisionHref}>
            <Button className="bg-gradient-to-r from-violet-600 to-blue-600 text-white">보드에 설치</Button>
          </Link>
        ) : (
          <Button
            disabled
            title="인증서가 아직 발급되지 않았습니다. 게이트웨이 편집에서 cert 발급 또는 수동 입력을 먼저 수행하세요."
            className="cursor-not-allowed bg-gradient-to-r from-violet-600 to-blue-600 text-white opacity-50"
          >
            보드에 설치
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

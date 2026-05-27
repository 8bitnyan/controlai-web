'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc/client';
import type { ProvisioningState, ProvisioningStep } from '@/lib/board-cli/provisioning-reducer';
import { useProvisioning } from '@/lib/board-cli/use-provisioning';
import { UnsupportedBrowserNotice } from './unsupported-browser-notice';

interface Props {
  gatewayId: string;
  orgId: string;
  projectId: string;
  siteGroupId: string;
}

export function ProvisionPageClient({ gatewayId, orgId, projectId, siteGroupId }: Props) {
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    setSupported(typeof navigator !== 'undefined' && 'serial' in navigator);
  }, []);

  const gw = trpc.gateway.get.useQuery({ orgId, gatewayId });
  const { state, start, retry } = useProvisioning(gatewayId, orgId);

  if (supported === false) return <UnsupportedBrowserNotice />;
  if (supported === null || gw.isLoading) return <div className="p-6">로딩 중...</div>;
  if (!gw.data) return <div className="p-6">게이트웨이를 찾을 수 없습니다.</div>;

  const backHref = `/orgs/${orgId}/projects/${projectId}/site-groups/${siteGroupId}/gateways/${gatewayId}`;

  return (
    <div className="max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">{gw.data.label} 설치</h1>

      <div className="space-y-2 rounded-lg border p-4">
        <div className="flex justify-between">
          <span className="text-sm text-muted-foreground">Group ID</span>
          <span className="font-mono">{gw.data.groupId}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-sm text-muted-foreground">브로커</span>
          <span className="font-mono">{gw.data.endpointURL}</span>
        </div>
      </div>

      {gw.data.desiredState === 'running' && (
        <div className="rounded border border-yellow-500 bg-yellow-50 p-3 text-sm dark:bg-yellow-950">
          이 게이트웨이는 현재 running 상태입니다. 설치 후 자동 reboot됩니다.
        </div>
      )}

      {state.step === 'IDLE' && (
        <button
          onClick={start}
          className="rounded bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2 text-white"
        >
          포트 선택 및 셋업 시작
        </button>
      )}

      {state.step !== 'IDLE' && <StepChecklist state={state} />}

      {state.step === 'ERROR' && state.failure && (
        <div className="space-y-2 rounded border border-red-500 bg-red-50 p-3 text-sm dark:bg-red-950">
          <div>
            <strong>{state.failure.step}</strong> 단계에서 실패
          </div>
          <div>{state.failure.reason}</div>
          <button onClick={retry} className="rounded bg-red-600 px-3 py-1 text-sm text-white">
            재시도
          </button>
        </div>
      )}

      {state.step === 'DONE' && (
        <div className="space-y-2 rounded border border-green-500 bg-green-50 p-4 dark:bg-green-950">
          <div className="font-semibold">설치 완료</div>
          <Link href={backHref} className="text-sm underline">
            게이트웨이로 돌아가기
          </Link>
        </div>
      )}

      <details className="rounded border p-3">
        <summary className="cursor-pointer text-sm">콘솔 로그 보기</summary>
        <pre className="mt-2 max-h-64 overflow-auto font-mono text-xs">{state.consoleLines.join('\n')}</pre>
      </details>
    </div>
  );
}

function StepChecklist({ state }: { state: ProvisioningState }) {
  const allSteps: { id: ProvisioningStep; label: string }[] = [
    { id: 'REQUESTING_PORT', label: '포트 선택' },
    { id: 'OPENING_PORT', label: '포트 열기' },
    { id: 'PROBING', label: '프로브' },
    { id: 'BOOTING_APP', label: '부트로더 boot' },
    { id: 'READING_DEVICE_INFO', label: '보드 정보 읽기' },
    { id: 'SENDING_GROUP_ID', label: 'group_id 전송' },
    { id: 'SENDING_BROKER', label: 'broker 전송' },
    { id: 'SENDING_CERTCA', label: 'CA 인증서 전송' },
    { id: 'SENDING_CERTCLIENT', label: 'Client 인증서 전송' },
    { id: 'SENDING_CERTKEY', label: 'Private Key 전송' },
    { id: 'REBOOTING', label: '리부트' },
  ];

  return (
    <ul className="space-y-2">
      {allSteps.map((s) => {
        const done = state.completedSteps.includes(s.id);
        const current = state.step === s.id;
        const failed = state.failure?.step === s.id;
        const icon = failed ? '✗' : done ? '✓' : current ? '◐' : '○';

        return (
          <li key={s.id} className="flex items-center gap-2 text-sm">
            <span
              className={
                failed
                  ? 'text-red-600'
                  : done
                    ? 'text-green-600'
                    : current
                      ? 'text-blue-600'
                      : 'text-muted-foreground'
              }
            >
              {icon}
            </span>
            <span>{s.label}</span>
            {current && state.chunkProgress && (
              <span className="text-xs text-muted-foreground">
                ({state.chunkProgress.sent}/{state.chunkProgress.total})
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

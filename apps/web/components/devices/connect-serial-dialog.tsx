'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc/client';
import { useProvisioning } from '@/lib/board-cli/use-provisioning';
import type { ProvisioningState, ProvisioningStep } from '@/lib/board-cli/provisioning-reducer';
import { toast } from 'sonner';

export function ConnectSerialDialog({
  open,
  onOpenChange,
  orgId,
  gatewayId,
  isSimulator,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orgId: string;
  gatewayId: string;
  isSimulator?: boolean;
}) {
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    setSupported(typeof navigator !== 'undefined' && 'serial' in navigator);
  }, []);

  const gw = trpc.gateway.get.useQuery({ orgId, gatewayId }, { enabled: open });
  const { state, start, retry } = useProvisioning(gatewayId, orgId);
  const payload = trpc.gateway.getProvisioningPayload.useQuery({ orgId, gatewayId }, { enabled: open && supported === false });

  const copyPayload = async () => {
    const p = await payload.refetch();
    if (!p.data) return;
    await navigator.clipboard.writeText(JSON.stringify(p.data, null, 2));
    toast.success('Provisioning payload copied');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Connect via Serial</DialogTitle>
          <DialogDescription>Provision gateway settings and certificates over Web Serial.</DialogDescription>
        </DialogHeader>

        {supported === null || gw.isLoading ? (
          <div className="p-2 text-sm text-muted-foreground">로딩 중...</div>
        ) : supported === false ? (
          <div className="space-y-3">
            <div className="rounded border border-yellow-500 bg-yellow-50 p-3 text-sm dark:bg-yellow-950">
              Web Serial API가 필요합니다. 데스크톱 Chrome 또는 Edge에서만 동작합니다.
            </div>
            <Button variant="outline" onClick={copyPayload}>
              프로비저닝 페이로드를 클립보드에 복사
            </Button>
          </div>
        ) : !gw.data ? (
          <div className="p-2 text-sm">게이트웨이를 찾을 수 없습니다.</div>
        ) : (
          <div className="space-y-4">
            {isSimulator && (
              <div className="rounded border border-amber-500 bg-amber-50 p-2 text-xs dark:bg-amber-950">
                Simulator gateway: provisioning is informational only.
              </div>
            )}

            <div className="space-y-1 rounded-lg border p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Group ID</span>
                <span className="font-mono">{gw.data.groupId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">브로커</span>
                <span className="font-mono">{gw.data.endpointURL}</span>
              </div>
            </div>

            {gw.data.desiredState === 'running' && (
              <div className="rounded border border-yellow-500 bg-yellow-50 p-2 text-xs dark:bg-yellow-950">
                이 게이트웨이는 현재 running 상태입니다. 설치 후 자동 reboot됩니다.
              </div>
            )}

            {state.step === 'IDLE' && (
              <button
                onClick={start}
                className="rounded bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2 text-sm text-white"
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
                <button onClick={retry} className="rounded bg-red-600 px-3 py-1 text-xs text-white">
                  재시도
                </button>
              </div>
            )}

            {state.step === 'DONE' && (
              <div className="rounded border border-green-500 bg-green-50 p-3 text-sm font-medium dark:bg-green-950">
                설치 완료
              </div>
            )}

            <details className="rounded border p-2">
              <summary className="cursor-pointer text-xs">콘솔 로그 보기</summary>
              <pre className="mt-2 max-h-64 overflow-auto font-mono text-xs">{state.consoleLines.join('\n')}</pre>
            </details>
          </div>
        )}
      </DialogContent>
    </Dialog>
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
    <ul className="space-y-1.5">
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

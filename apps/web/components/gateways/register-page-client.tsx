'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import type { MatchPlan, RegistrationDecisions } from '@controlai-web/shared-types';
import { BOARD_REGISTER_SEQUENCE, BOARD_REGISTER_STATUS_TIMEOUT_MS, BOARD_SERIAL_OPTIONS } from '../../../../packages/api/src/lib/board-cli-spec';
import { trpc } from '@/lib/trpc/client';
import { useCanvasStore } from '@/stores/canvas-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { registerReducer, INITIAL_STATE } from '@/lib/board-cli/register-reducer';
import { CliSession } from '@/lib/board-cli/cli-session';
import { getSerialPortAdapter, PORT_REQUEST_CANCELLED, type SerialPortHandle } from '@/lib/board-cli/serial-port-adapter';
import { parseStatusOutput } from '@/lib/board-cli/parse-status-output';
import { parseDiscoveredChild } from '@/lib/board-cli/parse-discovered-child';
import { RegisterProposalTable } from '@/components/register/register-proposal-table';
import { UnmatchedShadowsPanel } from '@/components/register/unmatched-shadows-panel';
import { ExtraChildrenPanel } from '@/components/register/extra-children-panel';
import { UnknownTypesPanel } from '@/components/register/unknown-types-panel';
import { ReRegisterBanner } from '@/components/register/re-register-banner';

type Props = { gatewayId: string; orgId: string; projectId: string; siteGroupId: string };

export function RegisterPageClient({ gatewayId, orgId, projectId, siteGroupId }: Props) {
  const [state, dispatch] = useReducer(registerReducer, INITIAL_STATE);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [decisions, setDecisions] = useState<RegistrationDecisions>({ confirmedMatches: [], rejectShadows: [], acceptExtras: [] });
  const [reRegisterAck, setReRegisterAck] = useState(false);
  const [registrationSessionId, setRegistrationSessionId] = useState<string | null>(null);
  const [matchPlan, setMatchPlan] = useState<MatchPlan | null>(null);
  const [consoleLines, setConsoleLines] = useState<string[]>([]);
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode') === 're-register' ? 're-register' : 'new';
  const begin = trpc.gateway.beginRegistration.useMutation();
  const propose = trpc.gateway.proposeRegistration.useMutation();
  const commit = trpc.gateway.commitRegistration.useMutation();
  const abort = trpc.gateway.abortRegistration.useMutation();
  const gw = trpc.gateway.get.useQuery({ orgId, gatewayId });
  const sessionRef = useRef<CliSession | null>(null);
  const handleRef = useRef<SerialPortHandle | null>(null);

  const inProgress = ['READING_STATUS', 'PROPOSING', 'AWAITING_USER_DECISION', 'COMMITTING'].includes(state.phase);
  const canCommit = Boolean(matchPlan) && (matchPlan?.unknownTypes.length ?? 0) === 0 && (mode !== 're-register' || reRegisterAck);

  useEffect(() => setSupported(typeof navigator !== 'undefined' && 'serial' in navigator), []);
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!inProgress) return;
      event.preventDefault();
      event.returnValue = 'Registration in progress; closing will abandon the session (auto-recovered in 30 min).';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [inProgress]);

  const cleanup = useCallback(async () => {
    await sessionRef.current?.dispose().catch(() => undefined);
    await handleRef.current?.close().catch(() => undefined);
    sessionRef.current = null;
    handleRef.current = null;
  }, []);

  const start = useCallback(async () => {
    dispatch({ type: 'START' });
    setConsoleLines([]);
    try {
      const beginResult = await begin.mutateAsync({ orgId, gatewayDeviceKey: gatewayId });
      setRegistrationSessionId(beginResult.registrationSessionId);
      const handle = await getSerialPortAdapter().requestPort();
      handleRef.current = handle;
      await handle.open(BOARD_SERIAL_OPTIONS);
      const session = new CliSession(handle);
      sessionRef.current = session;
      session.on('line', (line) => setConsoleLines((prev) => [...prev, line]));
      dispatch({ type: 'PORT_OPENED' });
      const statusCommand = BOARD_REGISTER_SEQUENCE[0];
      if (!statusCommand || statusCommand.kind !== 'plain') throw new Error('register command sequence missing status command');
      const statusLines = await session.sendCommand(statusCommand.command, { timeoutMs: BOARD_REGISTER_STATUS_TIMEOUT_MS });
      const parsedStatus = parseStatusOutput(statusLines.join('\n'));
      dispatch({ type: 'STATUS_READ', parsedStatus });
      const discoveredChildren = parsedStatus.bus485.children
        .map((child) => parseDiscoveredChild(child.raw, child.reportedTypeLabel))
        .filter((item): item is NonNullable<typeof item> => Boolean(item));
      dispatch({ type: 'STATUS_READ', parsedStatus });
      const proposal = await propose.mutateAsync({ orgId, registrationSessionId: beginResult.registrationSessionId, boardReportedUuid: parsedStatus.boardReportedUuid ?? '', discoveredChildren });
      setMatchPlan(proposal.matchPlan);
      setDecisions({ confirmedMatches: [], rejectShadows: [], acceptExtras: [] });
      dispatch({ type: 'PROPOSAL_RECEIVED', registrationSessionId: beginResult.registrationSessionId, matchPlan: proposal.matchPlan });
    } catch (error) {
      if (error === PORT_REQUEST_CANCELLED) return;
      dispatch({ type: 'FAIL', error: { message: error instanceof Error ? error.message : String(error) } });
      toast.error('Registration failed');
      await cleanup();
    }
  }, [begin, cleanup, gatewayId, mode, orgId, propose]);

  const onCommit = useCallback(async () => {
    if (!registrationSessionId || !matchPlan || !canCommit) return;
    dispatch({ type: 'USER_DECIDED', decisions });
    try {
      await commit.mutateAsync({ orgId, registrationSessionId, decisions, mode });
      if (gw.data?.id) {
        const canvasStore = useCanvasStore.getState();
        const gatewayNode = canvasStore.nodes.find((node) => node.id === gw.data?.id);
        if (gatewayNode) {
          decisions.acceptExtras.forEach((extra, index) => {
            if (!extra.placeOnCanvas) return;
            canvasStore.insertAutoCreatedNode({ deviceTypeId: extra.deviceTypeId, parentNodeId: gw.data!.id, label: `Auto ${index + 1}` }, gatewayNode.position, index);
          });
        }
      }
      dispatch({ type: 'COMMIT_SUCCESS' });
      toast.success('Registration committed');
      await cleanup();
    } catch (error) {
      dispatch({ type: 'COMMIT_FAILED', error: { message: error instanceof Error ? error.message : String(error) } });
      toast.error('Commit failed');
    }
  }, [canCommit, cleanup, commit, decisions, gatewayId, gw.data, matchPlan, orgId, registrationSessionId]);

  const onAbort = useCallback(async () => {
    if (!registrationSessionId) return;
    await abort.mutateAsync({ orgId, registrationSessionId }).catch(() => undefined);
    dispatch({ type: 'ABORT' });
    await cleanup();
  }, [abort, cleanup, gatewayId, orgId, registrationSessionId]);

  const backHref = useMemo(() => `/orgs/${orgId}/projects/${projectId}/site-groups/${siteGroupId}/gateways/${gatewayId}`, [gatewayId, orgId, projectId, siteGroupId]);

  if (supported === false) return <div className="p-6">Web Serial is not available in this browser.</div>;
  if (supported === null || gw.isLoading) return <div className="p-6">로딩 중...</div>;

  return <div className="max-w-4xl space-y-4 p-6"><Card><CardHeader><CardTitle>Gateway register</CardTitle></CardHeader><CardContent className="space-y-3"><div className="text-sm">Phase: {state.phase}</div><div className="flex gap-2"><Button onClick={start} disabled={state.phase !== 'IDLE'}>Start</Button>{state.phase !== 'IDLE' && state.phase !== 'DONE' && <Button variant="outline" onClick={onAbort}>Abort</Button>}</div><Dialog><DialogTrigger asChild><Button variant="outline">Raw console</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>CLI Raw Console</DialogTitle></DialogHeader><pre className="max-h-80 overflow-auto text-xs">{consoleLines.join('\n')}</pre></DialogContent></Dialog></CardContent></Card>{matchPlan && state.phase === 'AWAITING_USER_DECISION' && <div className="space-y-4"><ReRegisterBanner mode={mode} onAcknowledge={setReRegisterAck} /><RegisterProposalTable matchPlan={matchPlan} decisions={decisions} onDecisionsChange={setDecisions} /><UnmatchedShadowsPanel unmatched={matchPlan.unmatchedShadows.map((item) => ({ deviceKey: item.deviceKey, deviceTypeId: 'unknown' }))} decisions={decisions} onChange={setDecisions} /><ExtraChildrenPanel extras={matchPlan.extras} gatewayDeviceTypeId={'core-generic-gateway'} decisions={decisions} onChange={setDecisions} /><UnknownTypesPanel unknown={matchPlan.unknownTypes} /><Button onClick={onCommit} disabled={!canCommit}>Confirm and Commit</Button></div>}{state.phase === 'FAILED' && <Card><CardContent className="pt-6 space-y-2"><div className="text-red-600">{state.error.message}</div><Button onClick={() => window.location.reload()}>Retry</Button></CardContent></Card>}{state.phase === 'DONE' && <Card><CardContent className="pt-6"><div className="font-semibold">Done</div><div className="text-xs text-muted-foreground">Auto-created extras are inserted client-side only when canvas context exists; otherwise server appendNodeToNodeConfig already persisted.</div><Link href={backHref} className="text-sm underline">Back to gateway</Link></CardContent></Card>}</div>;
}

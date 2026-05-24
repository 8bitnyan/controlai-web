'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc/client';
import type { Plan, OpResult } from '@controlai-web/shared-types';
import { cn } from '@/lib/utils';
import { CheckCircle, XCircle, Loader2, Clock, AlertTriangle } from 'lucide-react';

interface ApplyModalProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  siteGroupId: string;
}

type ModalStep = 'preview' | 'confirm' | 'applying' | 'done';

export function ApplyModal({ open, onClose, orgId, siteGroupId }: ApplyModalProps) {
  const [step, setStep] = useState<ModalStep>('preview');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [opResults, setOpResults] = useState<OpResult[]>([]);
  const [applySuccess, setApplySuccess] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previewMutation = trpc.provision.preview.useMutation({
    onSuccess: (data) => {
      setPlan(data as unknown as Plan);
      setStep('confirm');
      setError(null);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const commitMutation = trpc.provision.commit.useMutation({
    onSuccess: (data) => {
      setOpResults(data.ops as unknown as OpResult[]);
      setApplySuccess(data.success);
      setStep('done');
    },
    onError: (err) => {
      setError(err.message);
      setStep('done');
    },
  });

  const utils = trpc.useUtils();

  function handleOpen() {
    setStep('preview');
    setPlan(null);
    setOpResults([]);
    setApplySuccess(null);
    setError(null);
    previewMutation.mutate({ orgId, siteGroupId });
  }

  // Auto-start preview when the modal opens
  useEffect(() => {
    if (open) {
      handleOpen();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleConfirm() {
    if (!plan) return;
    setStep('applying');
    setOpResults(
      plan.ops.map((op) => ({ opId: op.id, type: op.type, status: 'pending' as const })),
    );
    commitMutation.mutate({ orgId, siteGroupId, planId: plan.planId });
  }

  function handleRerun() {
    setPlan(null);
    setOpResults([]);
    setApplySuccess(null);
    setError(null);
    setStep('preview');
    previewMutation.mutate({ orgId, siteGroupId });
  }

  function handleClose() {
    if (applySuccess) {
      void utils.provision.status.invalidate({ orgId, siteGroupId });
      void utils.nodeConfig.load.invalidate({ orgId, siteGroupId });
    }
    onClose();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handleClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Apply Pipeline Configuration</DialogTitle>
        </DialogHeader>

        <div className="min-h-[200px]">
          {/* Loading / preview step */}
          {step === 'preview' && (
            <div className="flex items-center justify-center py-12 gap-3 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Computing plan…</span>
            </div>
          )}

          {/* Confirm step — show ops list */}
          {step === 'confirm' && plan && (
            <div className="space-y-3">
              {plan.ops.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg bg-green-50 p-4 text-green-700">
                  <CheckCircle className="h-5 w-5 flex-shrink-0" />
                  <span className="text-sm font-medium">
                    Nothing to apply — daemon is already up to date
                  </span>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    {plan.ops.length} operation{plan.ops.length > 1 ? 's' : ''} will be applied:
                  </p>
                  <OpList ops={plan.ops.map((op) => ({ opId: op.id, type: op.type, description: op.description, status: 'pending' as const }))} />
                </>
              )}
            </div>
          )}

          {/* Applying step */}
          {step === 'applying' && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Applying changes…</p>
              <OpList ops={opResults.map((r, i) => ({
                opId: r.opId,
                type: r.type,
                description: plan?.ops[i]?.description ?? r.type,
                status: r.status,
                errorDetail: r.errorDetail,
              }))} />
            </div>
          )}

          {/* Done step */}
          {step === 'done' && (
            <div className="space-y-3">
              {applySuccess ? (
                <div className="flex items-center gap-2 rounded-lg bg-green-50 p-3 text-green-700">
                  <CheckCircle className="h-5 w-5 flex-shrink-0" />
                  <span className="text-sm font-medium">All operations completed successfully.</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-red-700">
                  <XCircle className="h-5 w-5 flex-shrink-0" />
                  <span className="text-sm font-medium">Apply failed. Review errors below.</span>
                </div>
              )}
              <OpList ops={opResults.map((r, i) => ({
                opId: r.opId,
                type: r.type,
                description: plan?.ops[i]?.description ?? r.type,
                status: r.status,
                errorDetail: r.errorDetail,
              }))} />
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-red-700">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span className="text-sm">{error}</span>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex justify-between gap-2 pt-2 border-t">
          <Button variant="outline" onClick={handleClose}>
            {step === 'done' ? 'Close' : 'Cancel'}
          </Button>
          <div className="flex gap-2">
            {step === 'done' && !applySuccess && (
              <Button variant="outline" onClick={handleRerun}>
                Re-run failed ops
              </Button>
            )}
            {step === 'confirm' && (plan?.ops.length ?? 0) > 0 && (
              <Button onClick={handleConfirm} disabled={commitMutation.isPending}>
                {commitMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirm & Apply
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Op list component ────────────────────────────────────────────────────────

interface OpListItem {
  opId: string;
  type: string;
  description: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  errorDetail?: string;
}

function OpList({ ops }: { ops: OpListItem[] }) {
  return (
    <ol className="space-y-2" role="list" aria-label="Apply operations">
      {ops.map((op, idx) => (
        <li key={op.opId} className="rounded-md border px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-5 text-right">{idx + 1}.</span>
            <StatusIcon status={op.status} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{op.description}</div>
              <div className="text-xs text-muted-foreground">{op.type}</div>
            </div>
            <StatusBadge status={op.status} />
          </div>
          {op.errorDetail && op.status === 'failed' && (
            <pre className="mt-2 overflow-auto rounded bg-red-50 p-2 text-[11px] text-red-800 font-mono max-h-32 whitespace-pre-wrap break-all">
              {op.errorDetail}
            </pre>
          )}
        </li>
      ))}
    </ol>
  );
}

function StatusIcon({ status }: { status: OpListItem['status'] }) {
  switch (status) {
    case 'pending':
      return <Clock className="h-4 w-4 text-gray-400 flex-shrink-0" />;
    case 'running':
      return <Loader2 className="h-4 w-4 text-blue-500 animate-spin flex-shrink-0" />;
    case 'success':
      return <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />;
    case 'failed':
      return <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />;
  }
}

function StatusBadge({ status }: { status: OpListItem['status'] }) {
  const cls = cn(
    'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase',
    status === 'pending' && 'bg-gray-100 text-gray-600',
    status === 'running' && 'bg-blue-100 text-blue-600',
    status === 'success' && 'bg-green-100 text-green-600',
    status === 'failed' && 'bg-red-100 text-red-600',
  );
  return <span className={cls}>{status}</span>;
}

// ─── Standalone trigger button (used in canvas toolbar) ───────────────────────

interface ApplyButtonProps {
  orgId: string;
  siteGroupId: string;
}

export function ApplyButton({ orgId, siteGroupId }: ApplyButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Apply
      </Button>
      <ApplyModal
        open={open}
        onClose={() => setOpen(false)}
        orgId={orgId}
        siteGroupId={siteGroupId}
      />
    </>
  );
}

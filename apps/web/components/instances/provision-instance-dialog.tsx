'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

interface ProgressLogEntry { ts: string; message: string }
interface ProvisionProgress { stage: string; percent: number; log: ProgressLogEntry[] }
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';

interface Props {
  orgId: string;
  orgSlug: string;
  daemonBaseDomain?: string;
  existingEnvs: Array<'prod' | 'staging' | 'dev'>;
  onProvisioned?: (id: string) => void;
  trigger?: React.ReactNode;
}

export function ProvisionInstanceDialog({
  orgId,
  orgSlug,
  daemonBaseDomain,
  existingEnvs,
  onProvisioned,
  trigger,
}: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [env, setEnv] = useState<'prod' | 'staging' | 'dev'>('prod');
  const [provisioningInstanceId, setProvisioningInstanceId] = useState<string | null>(null);
  const [pollStartMs, setPollStartMs] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const resolvedDomain = daemonBaseDomain ?? process.env.NEXT_PUBLIC_DAEMON_BASE_DOMAIN ?? '';
  const shouldPoll = Boolean(provisioningInstanceId && pollStartMs);

  const provisionMutation = trpc.instance.provision.useMutation({
    onSuccess: (data) => {
      setErrorMsg(null);
      setProvisioningInstanceId(data.id);
      setPollStartMs(Date.now());
    },
  });

  const retryMutation = trpc.instance.retryProvision.useMutation({
    onSuccess: () => {
      setErrorMsg(null);
      setPollStartMs(Date.now());
    },
  });

  const deprovisionMutation = trpc.instance.deprovision.useMutation({
    onSuccess: async () => {
      setOpen(false);
      setProvisioningInstanceId(null);
      setPollStartMs(null);
      setErrorMsg(null);
      await utils.instance.list.invalidate({ orgId });
    },
  });

  const provisionedInstance = trpc.instance.get.useQuery(
    { orgId, instanceId: provisioningInstanceId ?? '' },
    { enabled: shouldPoll, refetchInterval: 2000 },
  );

  useEffect(() => {
    if (!pollStartMs || !provisioningInstanceId) return;
    const elapsed = Date.now() - pollStartMs;
    if (elapsed > 120_000) {
      setErrorMsg('Provisioning is taking longer than expected (>2 min). Check the AWS console for ECS task status, or wait and refresh.');
      setPollStartMs(null);
    }
  }, [pollStartMs, provisioningInstanceId, provisionedInstance.dataUpdatedAt]);

  useEffect(() => {
    if (!provisionedInstance.data || !provisioningInstanceId) return;
    if (provisionedInstance.data.status === 'HEALTHY') {
      void utils.instance.list.invalidate({ orgId });
      onProvisioned?.(provisioningInstanceId);
      setOpen(false);
      setProvisioningInstanceId(null);
      setPollStartMs(null);
      setErrorMsg(null);
      return;
    }
    if (provisionedInstance.data.status === 'PROVISION_FAILED') {
      setPollStartMs(null);
      setErrorMsg('Provisioning failed. Retry provisioning or deprovision this daemon.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provisionedInstance.data?.status, provisioningInstanceId]);

  const envOptions: Array<'prod' | 'staging' | 'dev'> = ['prod', 'staging', 'dev'];
  const isBusy = provisionMutation.isPending || retryMutation.isPending || deprovisionMutation.isPending;

  const previewUrl = useMemo(() => {
    if (!resolvedDomain) return `https://${orgSlug}-${env}`;
    return `https://${orgSlug}-${env}.${resolvedDomain}`;
  }, [orgSlug, env, resolvedDomain]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    const trimmedName = name.trim();
    if (trimmedName.length < 1 || trimmedName.length > 128) {
      setErrorMsg('Name must be between 1 and 128 characters.');
      return;
    }
    if (existingEnvs.includes(env)) {
      setErrorMsg(`The ${env} environment is already provisioned.`);
      return;
    }
    try {
      await provisionMutation.mutateAsync({ orgId, name: trimmedName, env });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Provisioning failed');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button>Provision new daemon</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Provision new daemon</DialogTitle>
          <DialogDescription>Create a managed daemon instance for this organization.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {errorMsg && (
            <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {errorMsg}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="provision-instance-name">Name</Label>
            <Input
              id="provision-instance-name"
              required
              minLength={1}
              maxLength={128}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isBusy || Boolean(provisioningInstanceId)}
            />
          </div>
          <div className="space-y-2">
            <Label>Environment</Label>
            <div className="space-y-2">
              {envOptions.map((option) => {
                const disabled = existingEnvs.includes(option);
                return (
                  <label key={option} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="provision-env"
                      value={option}
                      checked={env === option}
                      onChange={() => setEnv(option)}
                      disabled={disabled || isBusy || Boolean(provisioningInstanceId)}
                    />
                    <span className="capitalize">{option}</span>
                    {disabled && <span className="text-muted-foreground">(already provisioned)</span>}
                  </label>
                );
              })}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">URL preview: {previewUrl}</p>
          {provisioningInstanceId && (
            <ProgressBlock
              progress={(((provisionedInstance.data as unknown as { provisionProgress: ProvisionProgress | null } | undefined)?.provisionProgress) ?? null)}
              timedOut={pollStartMs === null && !errorMsg}
            />
          )}
          {provisionedInstance.data?.status === 'PROVISION_FAILED' && provisioningInstanceId && (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => retryMutation.mutate({ orgId, instanceId: provisioningInstanceId })}
                disabled={isBusy}
              >
                Retry
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => deprovisionMutation.mutate({ orgId, instanceId: provisioningInstanceId })}
                disabled={isBusy}
              >
                Deprovision
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isBusy}>
              Cancel
            </Button>
            <Button type="submit" disabled={isBusy || Boolean(provisioningInstanceId)}>
              {provisionMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Provisioning…
                </>
              ) : (
                'Provision daemon'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProgressBlock({ progress, timedOut }: { progress: ProvisionProgress | null; timedOut: boolean }) {
  const logRef = useRef<HTMLDivElement>(null);
  const logLength = progress?.log.length ?? 0;
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logLength]);

  const percent = progress?.percent ?? 0;
  const stage = progress?.stage ?? 'starting';

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium capitalize">{stage.replace(/_/g, ' ')}</span>
        <span className="tabular-nums text-muted-foreground">{percent}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>
      {progress && progress.log.length > 0 && (
        <div
          ref={logRef}
          className="max-h-40 overflow-y-auto rounded border bg-muted/40 p-2 font-mono text-xs"
        >
          {progress.log.map((entry, i) => {
            const time = entry.ts.slice(11, 19);
            return (
              <div key={`${entry.ts}-${i}`} className="whitespace-pre-wrap break-words">
                <span className="text-muted-foreground">[{time}]</span> {entry.message}
              </div>
            );
          })}
        </div>
      )}
      {timedOut && (
        <p className="text-xs text-muted-foreground">
          Still working… you can keep this dialog open or close and check the instances list.
        </p>
      )}
    </div>
  );
}

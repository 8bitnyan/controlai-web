'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';

interface SiteFormProps {
  siteGroupId: string;
  initialValues?: {
    siteId?: string;
    name?: string;
    brokerKind?: string;
    ingestDirection?: string;
    throughputTier?: string;
    retentionPeriod?: string;
  };
  onSuccess?: () => void;
}

const BROKER_KINDS = [
  { value: 'MOSQUITTO', label: 'Mosquitto' },
  { value: 'EMQX', label: 'EMQX' },
] as const;

const INGEST_DIRECTIONS = [
  { value: 'UNI', label: 'Unidirectional' },
  { value: 'BI', label: 'Bidirectional' },
] as const;

const THROUGHPUT_TIERS = [
  { value: 'LOW', label: 'Low (<1k msg/s)' },
  { value: 'MID', label: 'Mid (<10k msg/s)' },
  { value: 'HIGH', label: 'High (>10k msg/s)' },
] as const;

const RETENTION_PERIODS = [
  { value: '1m', label: '1 minute' },
  { value: '1h', label: '1 hour' },
  { value: '1d', label: '1 day' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
] as const;

export function SiteForm({
  siteGroupId,
  initialValues,
  onSuccess,
}: SiteFormProps) {
  const [name, setName] = useState(initialValues?.name ?? '');
  const [brokerKind, setBrokerKind] = useState(initialValues?.brokerKind ?? '');
  const [ingestDirection, setIngestDirection] = useState(
    initialValues?.ingestDirection ?? '',
  );
  const [throughputTier, setThroughputTier] = useState(
    initialValues?.throughputTier ?? '',
  );
  const [retentionPeriod, setRetentionPeriod] = useState(
    initialValues?.retentionPeriod ?? '',
  );
  const [error, setError] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const createSite = trpc.site.create.useMutation({
    onSuccess: () => {
      void utils.site.list.invalidate({ siteGroupId });
      onSuccess?.();
    },
  });
  const updateSite = trpc.site.update.useMutation({
    onSuccess: () => {
      void utils.site.list.invalidate({ siteGroupId });
      onSuccess?.();
    },
  });

  const isEdit = Boolean(initialValues?.siteId);
  const isPending = createSite.isPending || updateSite.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    try {
      if (isEdit && initialValues?.siteId) {
        await updateSite.mutateAsync({
          siteId: initialValues.siteId,
          name,
          brokerKind: (brokerKind as 'MOSQUITTO' | 'EMQX') || undefined,
          ingestDirection: (ingestDirection as 'UNI' | 'BI') || undefined,
          throughputTier: (throughputTier as 'LOW' | 'MID' | 'HIGH') || undefined,
          retentionPeriod:
            (retentionPeriod as '1m' | '1h' | '1d' | '7d' | '30d') || undefined,
        });
      } else {
        await createSite.mutateAsync({
          siteGroupId,
          name,
          brokerKind: (brokerKind as 'MOSQUITTO' | 'EMQX') || undefined,
          ingestDirection: (ingestDirection as 'UNI' | 'BI') || undefined,
          throughputTier: (throughputTier as 'LOW' | 'MID' | 'HIGH') || undefined,
          retentionPeriod:
            (retentionPeriod as '1m' | '1h' | '1d' | '7d' | '30d') || undefined,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save site');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="site-name">Site name</Label>
        <Input
          id="site-name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Building A — Floor 3"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="broker-kind">Broker</Label>
          <select
            id="broker-kind"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={brokerKind}
            onChange={(e) => setBrokerKind(e.target.value)}
          >
            <option value="">Select broker</option>
            {BROKER_KINDS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ingest-direction">Ingest direction</Label>
          <select
            id="ingest-direction"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={ingestDirection}
            onChange={(e) => setIngestDirection(e.target.value)}
          >
            <option value="">Select direction</option>
            {INGEST_DIRECTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="throughput-tier">Throughput tier</Label>
          <select
            id="throughput-tier"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={throughputTier}
            onChange={(e) => setThroughputTier(e.target.value)}
          >
            <option value="">Select tier</option>
            {THROUGHPUT_TIERS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="retention-period">Retention</Label>
          <select
            id="retention-period"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={retentionPeriod}
            onChange={(e) => setRetentionPeriod(e.target.value)}
          >
            <option value="">Select retention</option>
            {RETENTION_PERIODS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? (
          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{isEdit ? 'Saving…' : 'Creating…'}</>
        ) : (
          isEdit ? 'Save changes' : 'Create site'
        )}
      </Button>
    </form>
  );
}

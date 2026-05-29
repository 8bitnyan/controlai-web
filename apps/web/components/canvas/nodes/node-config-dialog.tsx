'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useCanvasStore } from '@/stores/canvas-store';
import { useCanvasContext } from '../canvas-context';
import { trpc } from '@/lib/trpc/client';
import type {
  NodeData,
  NodeType,
  SensorData,
  GatewayData,
  BrokerData,
  IngestData,
  TimescaleDBData,
  MonitoringData,
} from '@controlai-web/shared-types';

interface NodeConfigDialogProps {
  open: boolean;
  onClose: () => void;
  nodeId: string;
  nodeType: NodeType;
  data: NodeData;
}

export function NodeConfigDialog({
  open,
  onClose,
  nodeId,
  nodeType,
  data,
}: NodeConfigDialogProps) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const { orgId } = useCanvasContext();
  const device = useCanvasStore((s) => s.getDeviceByCanvasNodeId(nodeId));
  const registrationState = device?.registrationState ?? 'UNREGISTERED';
  const isLocked = registrationState !== 'UNREGISTERED';
  const identityText = registrationState === 'REGISTERED'
    ? (device?.realUuid ?? device?.deviceKey ?? '—')
    : (device?.deviceKey ?? '—');
  const updateDeviceMutation = trpc.device.update.useMutation();

  function handleSave(updates: Partial<NodeData>) {
    updateNodeData(nodeId, updates);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Configure {data.label}</DialogTitle>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">State</span>
              <span className="rounded border px-1.5 py-0.5 text-[10px] font-medium">
                {registrationState}
              </span>
            </div>
            <p className="font-mono text-[11px] text-muted-foreground">{identityText}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="simulationDesired">Simulation</Label>
            <label className="flex items-center gap-2 text-sm" htmlFor="simulationDesired">
              <input
                id="simulationDesired"
                type="checkbox"
                checked={device?.simulationDesired ?? true}
                disabled={!device || updateDeviceMutation.isPending}
                onChange={(e) => {
                  if (!device || !orgId) return;
                  updateDeviceMutation.mutate({
                    orgId,
                    deviceKey: device.deviceKey,
                    simulationDesired: e.currentTarget.checked,
                  });
                }}
              />
              <span>Enabled</span>
            </label>
          </div>
          {isLocked ? (
            <p
              className="text-xs text-muted-foreground"
              title="This device is REGISTERED. Edit config from the device management view, or unregister first."
            >
              This device is REGISTERED. Edit config from the device management view, or unregister first.
            </p>
          ) : null}
        </DialogHeader>
        <NodeConfigForm
          nodeType={nodeType}
          data={data}
          isLocked={isLocked}
          onSave={handleSave}
          onCancel={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}

interface FormProps {
  nodeType: NodeType;
  data: NodeData;
  isLocked: boolean;
  onSave: (updates: Partial<NodeData>) => void;
  onCancel: () => void;
}

function NodeConfigForm({ nodeType, data, isLocked, onSave, onCancel }: FormProps) {
  switch (nodeType) {
    case 'sensor':
      return <SensorConfigForm data={data as SensorData} isLocked={isLocked} onSave={onSave} onCancel={onCancel} />;
    case 'gateway':
      return <GatewayConfigForm data={data as GatewayData} isLocked={isLocked} onSave={onSave} onCancel={onCancel} />;
    case 'broker':
      return <BrokerConfigForm data={data as BrokerData} isLocked={isLocked} onSave={onSave} onCancel={onCancel} />;
    case 'ingest':
      return <IngestConfigForm data={data as IngestData} isLocked={isLocked} onSave={onSave} onCancel={onCancel} />;
    case 'timescaledb':
      return <TimescaleDBConfigForm data={data as TimescaleDBData} isLocked={isLocked} onSave={onSave} onCancel={onCancel} />;
    case 'monitoring':
      return <MonitoringConfigForm data={data as MonitoringData} isLocked={isLocked} onSave={onSave} onCancel={onCancel} />;
  }
}

// ─── Per-type forms ────────────────────────────────────────────────────────────

function SensorConfigForm({
  data,
  isLocked,
  onSave,
  onCancel,
}: {
  data: SensorData;
  isLocked: boolean;
  onSave: (u: Partial<NodeData>) => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        onSave({
          label: String(fd.get('label') ?? data.label),
          device_id: String(fd.get('device_id') ?? data.device_id),
          topic_prefix: String(fd.get('topic_prefix') ?? data.topic_prefix),
          qos: String(fd.get('qos') ?? data.qos) as '0' | '1' | '2',
        });
      }}
    >
      <Field label="Label" name="label" defaultValue={data.label} disabled={isLocked} />
      <Field label="Device ID" name="device_id" defaultValue={data.device_id} disabled={isLocked} />
      <Field label="Topic prefix" name="topic_prefix" defaultValue={data.topic_prefix} disabled={isLocked} />
      <SelectField label="QoS" name="qos" defaultValue={data.qos} options={[{ value: '0', label: 'QoS 0' }, { value: '1', label: 'QoS 1' }, { value: '2', label: 'QoS 2' }]} disabled={isLocked} />
      <FormActions onCancel={onCancel} />
    </form>
  );
}

function GatewayConfigForm({
  data,
  isLocked,
  onSave,
  onCancel,
}: {
  data: GatewayData;
  isLocked: boolean;
  onSave: (u: Partial<NodeData>) => void;
  onCancel: () => void;
}) {
  const { orgId, siteGroupId } = useCanvasContext();
  const { data: gateways } = trpc.gateway.list.useQuery(
    { orgId, siteGroupId },
    { enabled: !!(orgId && siteGroupId) },
  );

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        onSave({
          label: String(fd.get('label') ?? data.label),
          gateway_id: String(fd.get('gateway_id') ?? data.gateway_id),
          protocol: String(fd.get('protocol') ?? data.protocol) as 'mqtt' | 'coap' | 'http',
        });
      }}
    >
      <Field label="Label" name="label" defaultValue={data.label} disabled={isLocked} />
      {gateways && gateways.length > 0 ? (
        <div className="space-y-1">
          <Label htmlFor="gateway_id">Linked Gateway</Label>
          <select
            id="gateway_id"
            name="gateway_id"
            defaultValue={data.gateway_id}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            disabled={isLocked}
          >
            <option value="">— none —</option>
            {gateways.map((gw) => (
              <option key={gw.id} value={gw.id}>
                {gw.label} ({gw.lastStatus})
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Link this canvas node to a gateway row from the Gateways tab.
          </p>
        </div>
      ) : (
        <Field label="Gateway ID" name="gateway_id" defaultValue={data.gateway_id} disabled={isLocked} />
      )}
      <SelectField label="Protocol" name="protocol" defaultValue={data.protocol} options={[{ value: 'mqtt', label: 'MQTT' }, { value: 'coap', label: 'CoAP' }, { value: 'http', label: 'HTTP' }]} disabled={isLocked} />
      <FormActions onCancel={onCancel} />
    </form>
  );
}

function BrokerConfigForm({
  data,
  isLocked,
  onSave,
  onCancel,
}: {
  data: BrokerData;
  isLocked: boolean;
  onSave: (u: Partial<NodeData>) => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        onSave({
          label: String(fd.get('label') ?? data.label),
          kind: String(fd.get('kind') ?? data.kind) as 'mosquitto' | 'emqx',
          throughput: String(fd.get('throughput') ?? data.throughput) as 'low' | 'mid',
        });
      }}
    >
      <Field label="Label" name="label" defaultValue={data.label} disabled={isLocked} />
      <SelectField label="Broker kind" name="kind" defaultValue={data.kind} options={[{ value: 'mosquitto', label: 'Mosquitto' }, { value: 'emqx', label: 'EMQX' }]} disabled={isLocked} />
      <SelectField label="Throughput" name="throughput" defaultValue={data.throughput} options={[{ value: 'low', label: 'Low' }, { value: 'mid', label: 'Mid' }]} disabled={isLocked} />
      <FormActions onCancel={onCancel} />
    </form>
  );
}

function IngestConfigForm({
  data,
  isLocked,
  onSave,
  onCancel,
}: {
  data: IngestData;
  isLocked: boolean;
  onSave: (u: Partial<NodeData>) => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        onSave({
          label: String(fd.get('label') ?? data.label),
          direction: String(fd.get('direction') ?? data.direction) as 'uni' | 'bi',
          batch_size: Number(fd.get('batch_size') ?? data.batch_size),
        });
      }}
    >
      <Field label="Label" name="label" defaultValue={data.label} disabled={isLocked} />
      <SelectField label="Direction" name="direction" defaultValue={data.direction} options={[{ value: 'uni', label: 'Unidirectional' }, { value: 'bi', label: 'Bidirectional' }]} disabled={isLocked} />
      <Field label="Batch size" name="batch_size" type="number" defaultValue={String(data.batch_size)} disabled={isLocked} />
      <FormActions onCancel={onCancel} />
    </form>
  );
}

function TimescaleDBConfigForm({
  data,
  isLocked,
  onSave,
  onCancel,
}: {
  data: TimescaleDBData;
  isLocked: boolean;
  onSave: (u: Partial<NodeData>) => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        onSave({
          label: String(fd.get('label') ?? data.label),
          retention: String(fd.get('retention') ?? data.retention) as '1m' | '1h' | '1d' | '7d' | '30d',
        });
      }}
    >
      <Field label="Label" name="label" defaultValue={data.label} disabled={isLocked} />
      <SelectField
        label="Retention period"
        name="retention"
        defaultValue={data.retention}
        options={[
          { value: '1m', label: '1 minute' },
          { value: '1h', label: '1 hour' },
          { value: '1d', label: '1 day' },
          { value: '7d', label: '7 days' },
          { value: '30d', label: '30 days' },
        ]}
        disabled={isLocked}
      />
      <FormActions onCancel={onCancel} />
    </form>
  );
}

function MonitoringConfigForm({
  data,
  isLocked,
  onSave,
  onCancel,
}: {
  data: MonitoringData;
  isLocked: boolean;
  onSave: (u: Partial<NodeData>) => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const metrics = fd.getAll('metrics') as Array<'msg_rate' | 'lag' | 'error_rate'>;
        onSave({
          label: String(fd.get('label') ?? data.label),
          metrics: metrics.length > 0 ? metrics : ['msg_rate'],
        });
      }}
    >
      <Field label="Label" name="label" defaultValue={data.label} disabled={isLocked} />
      <div className="space-y-2">
        <Label>Metrics</Label>
        {(['msg_rate', 'lag', 'error_rate'] as const).map((m) => (
          <label key={m} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="metrics"
              value={m}
              defaultChecked={data.metrics.includes(m)}
              disabled={isLocked}
            />
            {m.replace('_', ' ')}
          </label>
        ))}
      </div>
      <FormActions onCancel={onCancel} />
    </form>
  );
}

// ─── Helper components ──────────────────────────────────────────────────────────

function Field({
  label,
  name,
  defaultValue,
  type = 'text',
  disabled = false,
}: {
  label: string;
  name: string;
  defaultValue: string;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} defaultValue={defaultValue} disabled={disabled} />
    </div>
  );
}

function SelectField({
  label,
  name,
  defaultValue,
  options,
  disabled = false,
}: {
  label: string;
  name: string;
  defaultValue: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        disabled={disabled}
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function FormActions({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button type="button" variant="outline" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" size="sm">
        Save
      </Button>
    </div>
  );
}

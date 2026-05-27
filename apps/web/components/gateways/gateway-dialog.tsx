'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { trpc } from '@/lib/trpc/client';
import type { GatewayDTO, SensorConfig } from '@controlai-web/shared-types';
import { Plus, Trash2, KeyRound, Loader2, ChevronDown, ChevronRight, Search } from 'lucide-react';

interface GatewayDialogProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  siteGroupId: string;
  /** If provided, the dialog edits an existing gateway instead of creating one. */
  existing?: GatewayDTO;
}

type Tab = 'identity' | 'credentials' | 'sensors' | 'json-topic';

const defaultSensor = (): SensorConfig => ({
  id: crypto.randomUUID(),
  type: 'temperature',
  min: 0,
  max: 100,
  walkStep: 1,
  intervalMs: 1000,
  unit: '°C',
});

export function GatewayDialog({ open, onClose, orgId, siteGroupId, existing }: GatewayDialogProps) {
  const [tab, setTab] = useState<Tab>('identity');

  // Identity fields
  const [label, setLabel] = useState(existing?.label ?? '');
  const [kind, setKind] = useState<'simulator' | 'physical'>(existing?.kind ?? 'simulator');
  const [mode, setMode] = useState<'cbor-modules-cloud' | 'json'>(existing?.mode ?? 'cbor-modules-cloud');
  const [groupId, setGroupId] = useState(existing?.groupId ?? '');
  const [clientId, setClientId] = useState(existing?.clientId ?? '');
  const [endpointURL, setEndpointURL] = useState(existing?.endpointURL ?? '');
  const [targetSiteId, setTargetSiteId] = useState('');
  const [brokerHost, setBrokerHost] = useState(existing?.brokerHost ?? '');
  const [brokerPort, setBrokerPort] = useState(existing?.brokerPort?.toString() ?? '');
  const [tlsServername, setTlsServername] = useState(existing?.tlsServername ?? '');
  const [advancedOpen, setAdvancedOpen] = useState(
    Boolean(existing?.brokerHost || existing?.brokerPort || existing?.tlsServername),
  );

  // Credentials
  const [rootCaPem, setRootCaPem] = useState('');
  const [clientCertPem, setClientCertPem] = useState('');
  const [clientKeyPem, setClientKeyPem] = useState('');
  const [manualCertOpen, setManualCertOpen] = useState(false);

  // Sensors
  const [sensors, setSensors] = useState<SensorConfig[]>(existing?.sensors ?? []);

  // JSON topic template
  const [jsonTopicTemplate, setJsonTopicTemplate] = useState(existing?.jsonTopicTemplate ?? '');

  const [error, setError] = useState<string | null>(null);
  const { data: sites = [] } = trpc.site.list.useQuery({ orgId, siteGroupId });
  const provisionedSites = sites.filter((s) => Boolean(s.controlaiSiteId));

  useEffect(() => {
    if (!existing && !targetSiteId && provisionedSites.length === 1) {
      const onlySite = provisionedSites[0];
      if (onlySite) setTargetSiteId(onlySite.id);
    }
  }, [existing, provisionedSites, targetSiteId]);

  const utils = trpc.useUtils();
  const createMutation = trpc.gateway.create.useMutation({
    onSuccess: () => {
      void utils.gateway.list.invalidate();
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  const previewIssueMutation = trpc.gateway.previewIssueFromDaemon.useMutation({
    onSuccess: (data) => {
      if (data.rootCaPem) setRootCaPem(data.rootCaPem);
      setClientCertPem(data.clientCertPem);
      setClientKeyPem(data.clientKeyPem);
      setError(
        data.rootCaPem
          ? null
          : 'Cert + key issued. Daemon did not return root CA — paste it manually above.',
      );
    },
    onError: (e) => setError(e.message),
  });
  const updateMutation = trpc.gateway.update.useMutation({
    onSuccess: () => {
      void utils.gateway.list.invalidate();
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  const [isDetectingBrokerEndpoint, setIsDetectingBrokerEndpoint] = useState(false);

  const pemRegex = /-----BEGIN[^-]+-----[\s\S]+?-----END[^-]+-----/;
  const pemValues = [rootCaPem, clientCertPem, clientKeyPem].map((value) => value.trim());
  const filledPemCount = pemValues.filter((value) => value.length > 0).length;
  const pemError =
    filledPemCount > 0 && filledPemCount < 3
      ? 'rootCa / clientCert / clientKey 세 가지 모두 함께 입력해야 합니다.'
      : pemValues.some((value) => value.length > 0 && !pemRegex.test(value))
        ? '올바른 PEM 형식이 아닙니다.'
        : null;

  const isRunning = existing?.lastStatus !== 'stopped' && existing?.lastStatus !== undefined;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (pemError) {
      setError(pemError);
      setTab('credentials');
      return;
    }

    if (existing) {
      const brokerHostValue = brokerHost.trim() || null;
      const brokerPortNumber = Number(brokerPort);
      const brokerPortValue = brokerPort.trim() ? (Number.isNaN(brokerPortNumber) ? null : brokerPortNumber) : null;
      const tlsServernameValue = tlsServername.trim() || null;
      updateMutation.mutate({
        orgId,
        gatewayId: existing.id,
        label: label || undefined,
        ...(rootCaPem ? { rootCaPem } : {}),
        ...(clientCertPem ? { clientCertPem } : {}),
        ...(clientKeyPem ? { clientKeyPem } : {}),
        sensors,
        jsonTopicTemplate: jsonTopicTemplate || null,
        brokerHost: brokerHostValue === existing.brokerHost ? undefined : brokerHostValue,
        brokerPort: brokerPortValue === existing.brokerPort ? undefined : brokerPortValue,
        tlsServername: tlsServernameValue === existing.tlsServername ? undefined : tlsServernameValue,
      });
    } else {
      if (!targetSiteId) {
        setError('Target Site (Broker) is required.');
        setTab('identity');
        return;
      }
      if (!rootCaPem || !clientCertPem || !clientKeyPem) {
        setError('All three PEM fields are required when creating a gateway.');
        setTab('credentials');
        return;
      }
      createMutation.mutate({
        orgId,
        siteGroupId,
        label,
        kind,
        mode,
        endpointURL,
        groupId,
        clientId,
        rootCaPem,
        clientCertPem,
        clientKeyPem,
        sensors,
        jsonTopicTemplate: jsonTopicTemplate || undefined,
        brokerHost: brokerHost.trim() || undefined,
        brokerPort: Number(brokerPort) || undefined,
        tlsServername: tlsServername.trim() || undefined,
      });
    }
  }

  function addSensor() {
    setSensors((prev) => [...prev, defaultSensor()]);
  }

  function removeSensor(id: string) {
    setSensors((prev) => prev.filter((s) => s.id !== id));
  }

  function updateSensor(id: string, patch: Partial<SensorConfig>) {
    setSensors((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'identity', label: 'Identity' },
    { id: 'credentials', label: 'Credentials' },
    { id: 'sensors', label: 'Sensors' },
    ...(mode === 'json' ? [{ id: 'json-topic' as Tab, label: 'JSON Topic' }] : []),
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{existing ? `Edit Gateway: ${existing.label}` : 'New Gateway'}</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 border-b mb-4">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden gap-4">
          <div className="flex-1 overflow-y-auto space-y-4">
            {/* Identity tab */}
            {tab === 'identity' && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="gw-target-site">Target Site (Broker)</Label>
                  <select
                    id="gw-target-site"
                    value={targetSiteId}
                    onChange={(e) => setTargetSiteId(e.target.value)}
                    disabled={!!existing || provisionedSites.length === 0}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  >
                    <option value="">Select a provisioned site...</option>
                    {sites.map((site) => (
                      <option key={site.id} value={site.id} disabled={!site.controlaiSiteId}>
                        {site.name} ({site.controlaiSiteId?.slice(0, 8) ?? 'Unprovisioned'})
                      </option>
                    ))}
                  </select>
                  {provisionedSites.length === 0 && (
                    <p className="text-xs text-destructive mt-1">No sites provisioned yet. Apply your canvas first.</p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gw-label">Label</Label>
                  <Input
                    id="gw-label"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="My Simulator"
                    required
                  />
                </div>
                <div className="rounded-md border">
                  <button
                    type="button"
                    onClick={() => setAdvancedOpen((prev) => !prev)}
                    className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium"
                  >
                    <span>Advanced (SNI routing)</span>
                    {advancedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  {advancedOpen && (
                    <div className="space-y-3 border-t px-3 py-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label htmlFor="gw-broker-host">Broker Host Override</Label>
                          <Input
                            id="gw-broker-host"
                            value={brokerHost}
                            onChange={(e) => setBrokerHost(e.target.value)}
                            placeholder="e.g. 52.79.241.139 (overrides endpointURL host)"
                            disabled={isRunning}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="gw-broker-port">Broker Port Override</Label>
                          <Input
                            id="gw-broker-port"
                            type="number"
                            min={1}
                            max={65535}
                            value={brokerPort}
                            onChange={(e) => setBrokerPort(e.target.value)}
                            placeholder="8883"
                            disabled={isRunning}
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="gw-tls-servername">TLS Server Name (SNI)</Label>
                        <Input
                          id="gw-tls-servername"
                          value={tlsServername}
                          onChange={(e) => setTlsServername(e.target.value)}
                          placeholder="e.g. ste_xxx.tnt_default.52-79-241-139.nip.io"
                          disabled={isRunning}
                        />
                        <p className="text-xs text-muted-foreground">
                          Required when broker public hostname differs from the SNI cert hostname (Traefik SNI routing).
                        </p>
                      </div>
                      <div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={isRunning || isDetectingBrokerEndpoint}
                          onClick={async () => {
                            setError(null);
                            try {
                              setIsDetectingBrokerEndpoint(true);
                              if (!targetSiteId) {
                                setError('Select Target Site first.');
                                return;
                              }
                              const detected = await utils.gateway.detectBrokerEndpointForSite.fetch({ orgId, siteId: targetSiteId });
                              setBrokerHost(detected.brokerHost);
                              setBrokerPort(detected.brokerPort.toString());
                              setTlsServername(detected.tlsServername);
                              if (!endpointURL.trim()) {
                                setEndpointURL(detected.endpointURL);
                              }
                            } catch (e) {
                              setError(e instanceof Error ? e.message : 'Failed to detect broker endpoint.');
                            } finally {
                              setIsDetectingBrokerEndpoint(false);
                            }
                          }}
                        >
                          {isDetectingBrokerEndpoint ? (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          ) : (
                            <Search className="mr-1 h-3 w-3" />
                          )}
                          Detect from project
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="gw-kind">Kind</Label>
                    <select
                      id="gw-kind"
                      value={kind}
                      onChange={(e) => setKind(e.target.value as 'simulator' | 'physical')}
                      disabled={!!existing}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                    >
                      <option value="simulator">Simulator</option>
                      <option value="physical">Physical</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="gw-mode">Protocol Mode</Label>
                    <select
                      id="gw-mode"
                      value={mode}
                      onChange={(e) => setMode(e.target.value as 'cbor-modules-cloud' | 'json')}
                      disabled={!!existing}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                    >
                      <option value="cbor-modules-cloud">CBOR (modules_cloud)</option>
                      <option value="json">JSON</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gw-endpoint">Endpoint URL</Label>
                  <Input
                    id="gw-endpoint"
                    value={endpointURL}
                    onChange={(e) => setEndpointURL(e.target.value)}
                    placeholder="mqtts://broker.example.com:8883"
                    disabled={isRunning}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="gw-groupid">Group ID (CN)</Label>
                    <Input
                      id="gw-groupid"
                      value={groupId}
                      onChange={(e) => setGroupId(e.target.value)}
                      placeholder="group-001"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="gw-clientid">Client ID / Node ID</Label>
                    <Input
                      id="gw-clientid"
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      placeholder="edge-node-001"
                    />
                  </div>
                </div>
              </>
            )}

            {/* Credentials tab */}
            {tab === 'credentials' && (
              <>
                {isRunning && (
                  <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                    Gateway is running — stop it before changing credentials.
                  </div>
                )}
                <div className="flex items-center justify-between rounded-md border border-dashed bg-muted/30 px-3 py-2">
                  <div className="text-xs text-muted-foreground">
                    Have the controlai daemon issue a cert for <code className="font-mono">{groupId || '<groupId>'}</code>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isRunning || !groupId || previewIssueMutation.isPending}
                    onClick={() => {
                      setError(null);
                      previewIssueMutation.mutate({ orgId, siteGroupId, gatewayCN: groupId });
                    }}
                    title={!groupId ? 'Set groupId in the Identity tab first' : isRunning ? 'Stop the gateway first' : 'Issue from daemon'}
                  >
                    {previewIssueMutation.isPending ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <KeyRound className="h-3 w-3 mr-1" />
                    )}
                    Issue from daemon
                  </Button>
                </div>
                <div className="rounded-md border">
                  <button
                    type="button"
                    onClick={() => setManualCertOpen((prev) => !prev)}
                    className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium"
                  >
                    <span>cert 수동 입력 (고급)</span>
                    {manualCertOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  {manualCertOpen && (
                    <div className="space-y-3 border-t px-3 py-3">
                      <div className="space-y-1">
                        <Label htmlFor="gw-rootca">Root CA (PEM)</Label>
                        <textarea
                          id="gw-rootca"
                          value={rootCaPem}
                          onChange={(e) => setRootCaPem(e.target.value)}
                          disabled={isRunning}
                          rows={4}
                          placeholder="-----BEGIN CERTIFICATE-----"
                          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs font-mono shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="gw-cert">Client Certificate (PEM)</Label>
                        </div>
                        <textarea
                          id="gw-cert"
                          value={clientCertPem}
                          onChange={(e) => setClientCertPem(e.target.value)}
                          disabled={isRunning}
                          rows={4}
                          placeholder="-----BEGIN CERTIFICATE-----"
                          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs font-mono shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="gw-key">Client Key (PEM)</Label>
                        <textarea
                          id="gw-key"
                          value={clientKeyPem}
                          onChange={(e) => setClientKeyPem(e.target.value)}
                          disabled={isRunning}
                          rows={4}
                          placeholder="-----BEGIN PRIVATE KEY-----"
                          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs font-mono shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                        />
                      </div>
                      {pemError && <p className="text-xs text-destructive">{pemError}</p>}
                    </div>
                  )}
                </div>
                {existing && (
                  <p className="text-xs text-muted-foreground">
                    Leave PEM fields blank to keep existing credentials.
                  </p>
                )}
              </>
            )}

            {/* Sensors tab */}
            {tab === 'sensors' && (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Configure sensor random-walk generators.</p>
                  <Button type="button" size="sm" variant="outline" onClick={addSensor}>
                    <Plus className="h-3 w-3 mr-1" /> Add sensor
                  </Button>
                </div>
                {sensors.length === 0 ? (
                  <div className="rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
                    No sensors configured — add one above.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {sensors.map((s) => (
                      <div key={s.id} className="rounded-md border p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground truncate max-w-[200px]">{s.id}</span>
                          <button
                            type="button"
                            onClick={() => removeSensor(s.id)}
                            className="text-destructive hover:opacity-70"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div className="space-y-1">
                            <Label className="text-xs">Type</Label>
                            <select
                              value={s.type}
                              onChange={(e) => updateSensor(s.id, { type: e.target.value as SensorConfig['type'] })}
                              className="flex h-7 w-full rounded-md border border-input bg-transparent px-2 py-0 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            >
                              <option value="temperature">Temperature</option>
                              <option value="pressure">Pressure</option>
                              <option value="humidity">Humidity</option>
                              <option value="vibration">Vibration</option>
                            </select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Unit</Label>
                            <Input
                              className="h-7 text-xs"
                              value={s.unit ?? ''}
                              onChange={(e) => updateSensor(s.id, { unit: e.target.value })}
                              placeholder="°C"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Interval (ms)</Label>
                            <Input
                              className="h-7 text-xs"
                              type="number"
                              value={s.intervalMs}
                              onChange={(e) => updateSensor(s.id, { intervalMs: Number(e.target.value) })}
                              min={100}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Min</Label>
                            <Input
                              className="h-7 text-xs"
                              type="number"
                              value={s.min}
                              onChange={(e) => updateSensor(s.id, { min: Number(e.target.value) })}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Max</Label>
                            <Input
                              className="h-7 text-xs"
                              type="number"
                              value={s.max}
                              onChange={(e) => updateSensor(s.id, { max: Number(e.target.value) })}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Walk Step</Label>
                            <Input
                              className="h-7 text-xs"
                              type="number"
                              step="0.01"
                              value={s.walkStep}
                              onChange={(e) => updateSensor(s.id, { walkStep: Number(e.target.value) })}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* JSON Topic tab */}
            {tab === 'json-topic' && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="gw-json-topic">Topic Template</Label>
                  <Input
                    id="gw-json-topic"
                    value={jsonTopicTemplate}
                    onChange={(e) => setJsonTopicTemplate(e.target.value)}
                    placeholder="sites/{siteId}/sensors/{sensorId}"
                  />
                  <p className="text-xs text-muted-foreground">
                    Supported tokens: <code>{'{siteId}'}</code> (= groupId), <code>{'{sensorId}'}</code> (= sensor id).
                    Leave blank for the default pattern.
                  </p>
                </div>
              </>
            )}
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {existing ? 'Save changes' : 'Create gateway'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

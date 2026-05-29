import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { getDeviceType, type DiscoveredChild, type RegistrationDecisions } from '@controlai-web/shared-types';

type Props = {
  extras: DiscoveredChild[];
  gatewayDeviceTypeId: string;
  decisions: RegistrationDecisions;
  onChange: (next: RegistrationDecisions) => void;
};

export function ExtraChildrenPanel({ extras, gatewayDeviceTypeId, decisions, onChange }: Props) {
  const gateway = getDeviceType(gatewayDeviceTypeId);
  const acceptedProtocols = new Set<string>((gateway?.ports ?? []).flatMap((p) => p.acceptsProtocols ?? []));
  const manifestOptions = extras
    .map((child) => getDeviceType(child.reportedTypeLabel))
    .filter((manifest): manifest is NonNullable<typeof manifest> => Boolean(manifest))
    .filter((manifest) => manifest.category === 'sensor')
    .filter((manifest) => manifest.ports.some((port) => acceptedProtocols.has(String(port.portType))));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Extra Discovered Children</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {extras.map((child) => {
          const key = child.raw;
          const existing = (decisions.acceptExtras ?? []).find((e) => e.discoveredRaw === key);

          return (
            <div key={key} className="space-y-3 rounded-md border p-3">
              <div className="font-mono text-xs text-muted-foreground">{child.raw}</div>
              <div>
                <Label className="mb-1 block text-xs">Manifest</Label>
                <select
                  value={existing?.deviceTypeId ?? ''}
                  onChange={(event) => {
                    const deviceTypeId = event.target.value;
                    const rest = (decisions.acceptExtras ?? []).filter((e) => e.discoveredRaw !== key);
                    onChange({
                      ...decisions,
                      acceptExtras: [
                        ...rest,
                        { discoveredRaw: key, deviceTypeId, placeOnCanvas: existing?.placeOnCanvas ?? true },
                      ],
                    });
                  }}
                  className="w-full rounded-md border bg-background p-2 text-sm"
                >
                  <option value="">Select device type</option>
                  {manifestOptions.map((manifest) => (
                    <option key={manifest.id} value={manifest.id}>
                      {manifest.id}
                    </option>
                  ))}
                </select>
              </div>
              <Label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={existing?.placeOnCanvas ?? true}
                  onChange={(event) => {
                    const rest = (decisions.acceptExtras ?? []).filter((e) => e.discoveredRaw !== key);
                    onChange({
                      ...decisions,
                      acceptExtras: [
                        ...rest,
                        {
                          discoveredRaw: key,
                          deviceTypeId: existing?.deviceTypeId ?? '',
                          placeOnCanvas: event.target.checked,
                        },
                      ],
                    });
                  }}
                />
                Auto-create canvas node
              </Label>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

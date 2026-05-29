import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import type { RegistrationDecisions } from '@controlai-web/shared-types';

type Device = {
  deviceKey: string;
  deviceTypeId: string;
  canvasNodeId?: string | null;
};

type RejectAction = 'keep-simulated' | 'soft-archive' | 'keep-as-manual';

type Props = {
  unmatched: Device[];
  decisions: RegistrationDecisions;
  onChange: (next: RegistrationDecisions) => void;
};

export function UnmatchedShadowsPanel({ unmatched, decisions, onChange }: Props) {
  const current = new Map((decisions.rejectShadows ?? []).map((d) => [d.shadowDeviceKey, d.action as RejectAction]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Unmatched Shadow Devices</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {unmatched.map((shadow) => {
          const action = current.get(shadow.deviceKey) ?? 'keep-simulated';
          return (
            <div key={shadow.deviceKey} className="rounded-md border p-3">
              <div className="mb-2 text-sm font-medium">{shadow.deviceTypeId}</div>
              <div className="mb-3 font-mono text-xs text-muted-foreground">{shadow.deviceKey}</div>
              <div className="space-y-2">
                {(['keep-simulated', 'soft-archive', 'keep-as-manual'] as const).map((value) => (
                  <Label key={value} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`shadow-${shadow.deviceKey}`}
                      checked={action === value}
                      onChange={() => {
                        const nextRejects = (decisions.rejectShadows ?? []).filter((d) => d.shadowDeviceKey !== shadow.deviceKey);
                        nextRejects.push({ shadowDeviceKey: shadow.deviceKey, action: value });
                        onChange({ ...decisions, rejectShadows: nextRejects });
                      }}
                    />
                    {value === 'keep-simulated' ? 'Keep simulated' : value === 'soft-archive' ? 'Soft-archive' : 'Convert to manual'}
                  </Label>
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

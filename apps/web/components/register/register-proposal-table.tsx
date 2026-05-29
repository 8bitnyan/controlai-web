import { Badge } from '@/components/ui/badge';
import type { MatchPlan, RegistrationDecisions } from '@controlai-web/shared-types';

type Props = {
  matchPlan: MatchPlan;
  decisions: RegistrationDecisions;
  onDecisionsChange: (newDecisions: RegistrationDecisions) => void;
};

const HIGH_CONFIDENCE = new Set(['EXACT', 'PORT_AND_ADDRESS']);

function confidenceClass(confidence: string) {
  if (confidence === 'EXACT') return 'bg-green-600/15 text-green-700 border-green-600/30';
  if (confidence === 'PORT_AND_ADDRESS') return 'bg-amber-600/15 text-amber-700 border-amber-600/30';
  if (confidence === 'NONE') return 'bg-red-600/15 text-red-700 border-red-600/30';
  return 'bg-muted text-muted-foreground border-border';
}

export function RegisterProposalTable({ matchPlan, decisions, onDecisionsChange }: Props) {
  const confirmedMap = new Map(
    decisions.confirmedMatches.map((item) => [item.shadowDeviceKey, item.discoveredRaw]),
  );

  const highConfidenceCount = matchPlan.confirmedMatches.filter((m) => HIGH_CONFIDENCE.has(m.confidence)).length;

  const applyConfirmed = (shadowDeviceKey: string, discoveredRaw: string, checked: boolean) => {
    const next = decisions.confirmedMatches.filter((m) => m.shadowDeviceKey !== shadowDeviceKey);
    if (checked) next.push({ shadowDeviceKey, discoveredRaw });
    onDecisionsChange({ ...decisions, confirmedMatches: next });
  };

  const applySwap = (shadowDeviceKey: string, value: string) => {
    if (value === '__create_new__') {
      const next = decisions.confirmedMatches.filter((m) => m.shadowDeviceKey !== shadowDeviceKey);
      onDecisionsChange({ ...decisions, confirmedMatches: next });
      return;
    }

    const discovered = matchPlan.confirmedMatches.find((m) => m.shadowDeviceKey === shadowDeviceKey)?.discovered;
    if (!discovered) return;

    const next = decisions.confirmedMatches.filter((m) => m.shadowDeviceKey !== shadowDeviceKey && m.shadowDeviceKey !== value);
    next.push({ shadowDeviceKey: value, discoveredRaw: discovered.raw });
    onDecisionsChange({ ...decisions, confirmedMatches: next });
  };

  const confirmAllHighConfidence = () => {
    const merged = new Map(decisions.confirmedMatches.map((m) => [m.shadowDeviceKey, m.discoveredRaw]));
    for (const child of matchPlan.confirmedMatches) {
      if (HIGH_CONFIDENCE.has(child.confidence)) {
        merged.set(child.shadowDeviceKey, child.discovered.raw);
      }
    }
    onDecisionsChange({
      ...decisions,
      confirmedMatches: Array.from(merged.entries()).map(([shadowDeviceKey, discoveredRaw]) => ({
        shadowDeviceKey,
        discoveredRaw,
      })),
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Matched sensors</h3>
        <button
          type="button"
          className="text-xs font-medium text-primary hover:underline"
          onClick={confirmAllHighConfidence}
        >
          Confirm all ({highConfidenceCount} high-confidence)
        </button>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="w-12 py-2">OK</th>
            <th className="py-2">Shadow device</th>
            <th className="py-2">Discovered child</th>
            <th className="py-2">Confidence</th>
            <th className="py-2">Swap</th>
          </tr>
        </thead>
        <tbody>
          {matchPlan.confirmedMatches.map((match) => {
            const checked = confirmedMap.has(match.shadowDeviceKey)
              ? confirmedMap.get(match.shadowDeviceKey) === match.discovered.raw
              : HIGH_CONFIDENCE.has(match.confidence);

            return (
              <tr key={`${match.shadowDeviceKey}-${match.discovered.raw}`} className="border-b">
                <td className="py-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => applyConfirmed(match.shadowDeviceKey, match.discovered.raw, event.target.checked)}
                  />
                </td>
                <td className="py-2 font-mono text-xs">{match.shadowDeviceKey}</td>
                <td className="py-2 font-mono text-xs">{match.discovered.raw}</td>
                <td className="py-2">
                  <Badge variant="outline" className={confidenceClass(match.confidence)}>
                    {match.confidence}
                  </Badge>
                </td>
                <td className="py-2">
                  <select
                    className="h-8 w-[220px] rounded-md border bg-background px-2 text-xs"
                    defaultValue=""
                    onChange={(event) => applySwap(match.shadowDeviceKey, event.target.value)}
                  >
                    <option value="">Keep suggested</option>
                      {matchPlan.unmatchedShadows.map((shadow) => (
                        <option key={shadow.deviceKey} value={shadow.deviceKey}>
                          {shadow.deviceKey}
                        </option>
                      ))}
                    <option value="__create_new__">Create new node</option>
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

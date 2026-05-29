import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DiscoveredChild } from '@controlai-web/shared-types';
import Link from 'next/link';

type Props = {
  unknown: DiscoveredChild[];
};

export function UnknownTypesPanel({ unknown }: Props) {
  if (unknown.length === 0) return null;

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>Unknown device types detected</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm text-destructive">
          Commit blocked until all unknown types have a registered manifest.
        </div>
        <ul className="space-y-1">
          {unknown.map((item) => (
            <li key={item.raw} className="font-mono text-xs">
              firmwareTypeCode: {item.firmwareTypeCode}
            </li>
          ))}
        </ul>
        <Link href="/docs/device-type-authoring" className="text-sm underline">
          Open device type authoring docs
        </Link>
      </CardContent>
    </Card>
  );
}

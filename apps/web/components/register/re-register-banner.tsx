'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useEffect, useState } from 'react';

type Props = {
  mode?: 'new' | 're-register';
  onAcknowledge: (acked: boolean) => void;
};

export function ReRegisterBanner({ mode, onAcknowledge }: Props) {
  const [acked, setAcked] = useState(false);

  useEffect(() => {
    onAcknowledge(acked);
  }, [acked, onAcknowledge]);

  if (mode !== 're-register') return null;

  return (
    <Card className="border-amber-400/50 bg-amber-50/40">
      <CardHeader>
        <CardTitle>Re-registering this board</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">
          This flow attempts cert revocation for the previous identity, then issues and stores a new client certificate.
        </p>
        <Label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={acked} onChange={(event) => setAcked(event.target.checked)} />
          I understand this will rotate board identity and certificate.
        </Label>
      </CardContent>
    </Card>
  );
}

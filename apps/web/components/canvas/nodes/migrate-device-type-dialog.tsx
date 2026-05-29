'use client';

import { useMemo, useState } from 'react';
import React from 'react';
import { z } from 'zod';
import { listDeviceTypes, Category } from '@controlai-web/shared-types';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props { open: boolean; onClose: () => void; nodeId: string }

type CategoryType = z.infer<typeof Category>;

export function MigrateDeviceTypeDialog({ open, onClose, nodeId }: Props) {
  const [category, setCategory] = useState<'any' | CategoryType>('any');
  const items = useMemo(() => category === 'any' ? listDeviceTypes() : listDeviceTypes({ category }), [category]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Migrate device type</DialogTitle></DialogHeader>
        <select value={category} onChange={(e) => setCategory(e.target.value as 'any' | CategoryType)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
          {['any', 'sensor', 'gateway', 'broker', 'ingest', 'tsdb', 'monitoring'].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="max-h-72 space-y-1 overflow-auto">
          {items.map((m) => (
            <button key={m.id} type="button" className="w-full rounded border p-2 text-left hover:bg-muted/30" onClick={() => { window.queueMicrotask(() => {}); import('@/stores/canvas-store').then(({ useCanvasStore }) => useCanvasStore.getState().replaceDeviceType(nodeId, m.id)); onClose(); }}>
              <div className="text-xs font-semibold">{m.displayName}</div>
              <div className="text-[10px] text-muted-foreground">{[m.manufacturer, m.model].filter(Boolean).join(' / ')} · {m.id}</div>
            </button>
          ))}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

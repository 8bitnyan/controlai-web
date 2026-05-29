'use client';
import { useMemo, useState } from 'react';
import React from 'react';
import * as Icons from 'lucide-react';
import { listDeviceTypes, LEGACY_TYPE_MAP } from '@controlai-web/shared-types';
import { Input } from '@/components/ui/input';
import { useCanvasContext } from './canvas-context';

const tabs = ['sensor', 'gateway', 'broker', 'ingest', 'tsdb', 'monitoring'] as const;

export function NodePalette() {
  const { orgId } = useCanvasContext();
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<(typeof tabs)[number]>('sensor');
  const all = listDeviceTypes();
  const key = `controlai:palette:recent:${orgId}`;
  const recent = useMemo(() => { try { return orgId ? (JSON.parse(localStorage.getItem(key) ?? '[]') as string[]) : []; } catch { return []; } }, [key, orgId]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const source = q ? all : all.filter((m) => m.category === active);
    return source.filter((m) => !q || `${m.displayName} ${m.manufacturer ?? ''} ${m.model ?? ''} ${(m.firmwareTypeIds ?? []).join(' ')}`.toLowerCase().includes(q));
  }, [all, active, search]);
  function onDragStart(event: React.DragEvent, deviceTypeId: string, category: string) {
    event.dataTransfer.setData('application/reactflow-devicetypeid', deviceTypeId);
    if (category in LEGACY_TYPE_MAP) event.dataTransfer.setData('application/reactflow-nodetype', category);
    event.dataTransfer.effectAllowed = 'move';
    if (orgId) localStorage.setItem(key, JSON.stringify([deviceTypeId, ...recent.filter((r) => r !== deviceTypeId)].slice(0, 8)));
  }

  return (
    <aside
      className="flex w-48 flex-col gap-2 rounded-lg border bg-background p-3 shadow-sm"
      aria-label="Node palette"
    >
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search device types" className="h-8" />
      <div className="grid grid-cols-2 gap-1">{tabs.map((t) => <button key={t} type="button" className="rounded border px-2 py-1 text-[10px] capitalize" onClick={() => setActive(t)}>{t}</button>)}</div>
      {search.trim() === '' && recent.length > 0 && <div className="text-[10px] text-muted-foreground">Recently used: {recent.join(', ')}</div>}
      {filtered.map((item) => {
        const Icon = (Icons[item.visual.iconRef as keyof typeof Icons] ?? Icons.Box) as React.ComponentType<{ className?: string }>;
        return (
        <div
          key={item.id}
          draggable
          onDragStart={(e) => onDragStart(e, item.id, item.category)}
          className="flex cursor-grab items-start gap-2 rounded-md border-2 bg-white p-2 shadow-sm active:cursor-grabbing hover:bg-muted/30 select-none"
          role="button"
          aria-label={`Drag to add ${item.displayName} node`}
          tabIndex={0}
        >
          <Icon className="mt-0.5 h-4 w-4" />
          <div className="min-w-0">
            <div className="text-xs font-semibold">
              {item.displayName}
            </div>
            <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">
              {search.trim() ? `${item.category} · ${item.id}` : item.id}
            </div>
          </div>
        </div>
      )})}
    </aside>
  );
}

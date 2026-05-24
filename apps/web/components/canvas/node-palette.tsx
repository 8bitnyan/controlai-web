'use client';

import type { NodeType } from '@controlai-web/shared-types';

interface PaletteItem {
  type: NodeType;
  icon: string;
  label: string;
  description: string;
  color: string;
}

const PALETTE_ITEMS: PaletteItem[] = [
  {
    type: 'sensor',
    icon: '📡',
    label: 'Sensor',
    description: 'IoT device data source',
    color: 'border-sky-400 text-sky-700',
  },
  {
    type: 'gateway',
    icon: '🔀',
    label: 'Gateway',
    description: 'Edge device proxy',
    color: 'border-violet-400 text-violet-700',
  },
  {
    type: 'broker',
    icon: '📨',
    label: 'Broker',
    description: 'Mosquitto or EMQX broker',
    color: 'border-orange-400 text-orange-700',
  },
  {
    type: 'ingest',
    icon: '⬇️',
    label: 'Ingest',
    description: 'Data ingestion service',
    color: 'border-teal-400 text-teal-700',
  },
  {
    type: 'timescaledb',
    icon: '🗄️',
    label: 'TimescaleDB',
    description: 'Time-series database',
    color: 'border-indigo-400 text-indigo-700',
  },
  {
    type: 'monitoring',
    icon: '📊',
    label: 'Monitoring',
    description: 'Telemetry observer',
    color: 'border-rose-400 text-rose-700',
  },
];

export function NodePalette() {
  function onDragStart(event: React.DragEvent, nodeType: NodeType) {
    event.dataTransfer.setData('application/reactflow-nodetype', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  }

  return (
    <aside
      className="flex w-48 flex-col gap-2 rounded-lg border bg-background p-3 shadow-sm"
      aria-label="Node palette"
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Node types
      </p>
      {PALETTE_ITEMS.map((item) => (
        <div
          key={item.type}
          draggable
          onDragStart={(e) => onDragStart(e, item.type)}
          className={`flex cursor-grab items-start gap-2 rounded-md border-2 bg-white p-2 shadow-sm active:cursor-grabbing ${item.color} hover:bg-muted/30 select-none`}
          role="button"
          aria-label={`Drag to add ${item.label} node`}
          tabIndex={0}
        >
          <span className="mt-0.5 text-base leading-none" aria-hidden>
            {item.icon}
          </span>
          <div className="min-w-0">
            <div className={`text-xs font-semibold ${item.color.split(' ')[1]}`}>
              {item.label}
            </div>
            <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">
              {item.description}
            </div>
          </div>
        </div>
      ))}
      <p className="mt-2 text-[10px] text-muted-foreground leading-snug">
        Drag node types from the panel to start
      </p>
    </aside>
  );
}

'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { WidgetType, WidgetConfig } from '@controlai-web/shared-types';
import { WIDGET_TYPES } from '@controlai-web/shared-types';
import { Plus } from 'lucide-react';

const WIDGET_META: Record<WidgetType, { label: string; description: string; icon: string }> = {
  'msg-rate-chart': {
    label: 'Message Rate Chart',
    description: 'Real-time echarts line chart of messages per second',
    icon: '📈',
  },
  'status-board': {
    label: 'Status Board',
    description: 'Grid of node health indicators for this SiteGroup',
    icon: '🔦',
  },
  'last-n-messages': {
    label: 'Last Messages',
    description: 'Table of the last 50 MQTT messages from Redis',
    icon: '📋',
  },
  'capacity-gauge': {
    label: 'Capacity Gauge',
    description: 'Daemon instance capacity utilization gauge',
    icon: '🌡️',
  },
  'sensor-io-stream': {
    label: 'Sensor I/O Stream',
    description: 'Live side-by-side view of simulator outbound and broker inbound messages',
    icon: '📡',
  },
};

interface AddWidgetDialogProps {
  onAdd: (widget: WidgetConfig) => void;
}

export function AddWidgetDialog({ onAdd }: AddWidgetDialogProps) {
  const [open, setOpen] = useState(false);

  function handleSelect(type: WidgetType) {
    onAdd({
      id: crypto.randomUUID(),
      type,
      title: WIDGET_META[type].label,
      config: {},
    });
    setOpen(false);
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-4 w-4" />
        Add widget
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Widget</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {WIDGET_TYPES.map((type) => {
              const meta = WIDGET_META[type];
              return (
                <button
                  key={type}
                  onClick={() => handleSelect(type)}
                  className="flex w-full items-start gap-3 rounded-lg border p-3 text-left hover:bg-muted/50 transition-colors"
                >
                  <span className="text-xl" aria-hidden>{meta.icon}</span>
                  <div>
                    <div className="text-sm font-medium">{meta.label}</div>
                    <div className="text-xs text-muted-foreground">{meta.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

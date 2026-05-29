'use client';

import { useState, useCallback, useEffect } from 'react';
import { ResponsiveGridLayout } from 'react-grid-layout';
import type { LayoutItem, Layout, ResponsiveLayouts } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { trpc } from '@/lib/trpc/client';
import type { WidgetConfig } from '@controlai-web/shared-types';
import { WidgetWrapper } from './widget-wrapper';
import { AddWidgetDialog } from './add-widget-dialog';
import { MsgRateChart } from './widgets/msg-rate-chart';
import { StatusBoard } from './widgets/status-board';
import { LastNMessages } from './widgets/last-n-messages';
import { CapacityGauge } from './widgets/capacity-gauge';
import { SensorIoStream } from './widgets/sensor-io-stream';
import { LayoutDashboard } from 'lucide-react';

interface DashboardGridProps {
  orgId: string;
  siteGroupId: string;
  instanceId?: string;
  siteId?: string;
  isReadOnly?: boolean;
}

interface PersistedLayout {
  widget: WidgetConfig;
  layout: LayoutItem;
}

export function DashboardGrid({
  orgId,
  siteGroupId,
  instanceId,
  siteId,
  isReadOnly,
}: DashboardGridProps) {
  const [items, setItems] = useState<PersistedLayout[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Narrow type to avoid TS2589 deep inference from tRPC return type
  const { data: rawDashboard } = trpc.dashboard.load.useQuery({ orgId, siteGroupId });
  const dashboard = rawDashboard as { layout: unknown } | null | undefined;
  const saveMutation = trpc.dashboard.save.useMutation();

  // Initialise from server
  useEffect(() => {
    if (dashboard && !loaded) {
      const raw = dashboard.layout as unknown as PersistedLayout[];
      setItems(Array.isArray(raw) ? raw : []);
      setLoaded(true);
    } else if (dashboard === null && !loaded) {
      setLoaded(true);
    }
  }, [dashboard, loaded]);

  const persist = useCallback(
    (newItems: PersistedLayout[]) => {
      void saveMutation.mutateAsync({
        orgId,
        siteGroupId,
        layout: newItems.map((item) => item.widget),
      });
    },
    [orgId, siteGroupId, saveMutation],
  );

  function handleLayoutChange(_layout: Layout, allLayouts: ResponsiveLayouts<string>) {
    const lgLayouts = allLayouts.lg ?? allLayouts.md ?? [];
    const newItems = items.map((item) => {
      const found = lgLayouts.find((l) => l.i === item.widget.id);
      return found ? { ...item, layout: found } : item;
    });
    setItems(newItems);
    persist(newItems);
  }

  function handleAddWidget(widget: WidgetConfig) {
    const defaultW = widget.type === 'sensor-io-stream' ? 12 : 4;
    const defaultH = widget.type === 'sensor-io-stream' ? 8 : 4;
    const newItem: PersistedLayout = {
      widget,
      layout: {
        i: widget.id,
        x: (items.length % 4) * 3,
        y: Infinity,
        w: defaultW,
        h: defaultH,
      },
    };
    const newItems = [...items, newItem];
    setItems(newItems);
    persist(newItems);
  }

  function handleRemoveWidget(widgetId: string) {
    const newItems = items.filter((i) => i.widget.id !== widgetId);
    setItems(newItems);
    persist(newItems);
  }

  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        Loading dashboard…
      </div>
    );
  }

  const layouts: ResponsiveLayouts<string> = {
    lg: items.map((i) => i.layout),
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">Dashboard</h2>
        {!isReadOnly && (
          <AddWidgetDialog onAdd={handleAddWidget} />
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <LayoutDashboard className="mb-3 h-10 w-10 text-muted-foreground" />
          <p className="font-medium text-sm">No widgets yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {isReadOnly ? 'No widgets have been added to this dashboard.' : 'Click Add widget to get started.'}
          </p>
        </div>
      ) : (
        <ResponsiveGridLayout
          className="layout"
          layouts={layouts}
          breakpoints={{ lg: 1200, md: 768 }}
          cols={{ lg: 12, md: 6 }}
          rowHeight={60}
          dragConfig={{ enabled: !isReadOnly, handle: '.drag-handle' }}
          resizeConfig={{ enabled: !isReadOnly }}
          onLayoutChange={handleLayoutChange}
          width={1200}
        >
          {items.map(({ widget }) => (
            <div key={widget.id}>
              <WidgetWrapper
                title={widget.title ?? widget.type}
                onRemove={() => handleRemoveWidget(widget.id)}
                isReadOnly={isReadOnly}
              >
                <WidgetContent
                  widget={widget}
                  orgId={orgId}
                  siteGroupId={siteGroupId}
                  siteId={siteId}
                  instanceId={instanceId}
                />
              </WidgetWrapper>
            </div>
          ))}
        </ResponsiveGridLayout>
      )}
    </div>
  );
}

function WidgetContent({
  widget,
  orgId,
  siteGroupId,
  siteId,
  instanceId,
}: {
  widget: WidgetConfig;
  orgId: string;
  siteGroupId: string;
  siteId?: string;
  instanceId?: string;
}) {
  switch (widget.type) {
    case 'msg-rate-chart':
      return <MsgRateChart orgId={orgId} siteId={siteId ?? ''} />;
    case 'status-board':
      return <StatusBoard orgId={orgId} siteGroupId={siteGroupId} />;
    case 'last-n-messages':
      return <LastNMessages orgId={orgId} siteId={siteId ?? ''} />;
    case 'capacity-gauge':
      return <CapacityGauge orgId={orgId} instanceId={instanceId ?? ''} />;
    case 'sensor-io-stream':
      return <SensorIoStream orgId={orgId} siteGroupId={siteGroupId} />;
    default:
      return null;
  }
}

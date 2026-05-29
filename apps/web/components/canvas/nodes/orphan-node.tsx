'use client';

import { useState } from 'react';
import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useCanvasStore } from '@/stores/canvas-store';
import { MigrateDeviceTypeDialog } from './migrate-device-type-dialog';

export default function OrphanNode({ id, data }: NodeProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="relative min-w-[180px] rounded-lg border-2 border-gray-400 bg-muted px-3 py-2 shadow-sm">
        <Handle type="target" position={Position.Left} />
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-muted-foreground">Orphan node</div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => setOpen(true)}>Migrate…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => useCanvasStore.getState().setNodes(useCanvasStore.getState().nodes.filter((n) => n.id !== id))}>Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="mt-1 rounded border border-gray-400 px-2 py-1 text-[10px]">Unknown device type: {(data as { deviceTypeId?: string }).deviceTypeId ?? '(none)'}</div>
        <Handle type="source" position={Position.Right} />
      </div>
      <MigrateDeviceTypeDialog open={open} onClose={() => setOpen(false)} nodeId={id} />
    </>
  );
}

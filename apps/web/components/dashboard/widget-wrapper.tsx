'use client';

import { GripVertical, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WidgetWrapperProps {
  title: string;
  onRemove: () => void;
  children: React.ReactNode;
  className?: string;
  isReadOnly?: boolean;
}

export function WidgetWrapper({
  title,
  onRemove,
  children,
  className,
  isReadOnly,
}: WidgetWrapperProps) {
  return (
    <div
      className={cn(
        'flex h-full flex-col overflow-hidden rounded-lg border bg-background shadow-sm',
        className,
      )}
      role="region"
      aria-label={title}
    >
      {/* Widget header — drag handle */}
      <div className="drag-handle flex items-center justify-between border-b px-3 py-2">
        {!isReadOnly && (
          <GripVertical
            className="h-4 w-4 cursor-grab text-muted-foreground active:cursor-grabbing"
            aria-hidden
          />
        )}
        <span className="flex-1 px-2 text-sm font-medium truncate">{title}</span>
        {!isReadOnly && (
          <button
            onClick={onRemove}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`Remove ${title} widget`}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {/* Widget content */}
      <div className="flex-1 overflow-hidden p-3">{children}</div>
    </div>
  );
}

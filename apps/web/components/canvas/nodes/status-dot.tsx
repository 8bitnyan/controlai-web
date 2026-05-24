import { cn } from '@/lib/utils';
import type { NodeStatus } from '@controlai-web/shared-types';

interface StatusDotProps {
  status: NodeStatus;
  msgPerSec?: number;
  className?: string;
}

const STATUS_COLORS: Record<NodeStatus, string> = {
  UNKNOWN: 'bg-gray-400',
  HEALTHY: 'bg-green-500',
  DEGRADED: 'bg-yellow-500',
  UNREACHABLE: 'bg-red-500',
};

export function StatusDot({ status, msgPerSec, className }: StatusDotProps) {
  return (
    <div className={cn('absolute -top-1 -right-1 flex items-center gap-1', className)}>
      {msgPerSec !== undefined && msgPerSec > 0 && (
        <span className="text-[9px] font-mono text-muted-foreground leading-none">
          {msgPerSec} msg/s
        </span>
      )}
      <span
        className={cn(
          'h-2.5 w-2.5 rounded-full border border-white shadow-sm',
          STATUS_COLORS[status],
        )}
        aria-label={`Status: ${status}`}
        role="status"
      />
    </div>
  );
}

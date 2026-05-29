'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';

export default function AdminUnclaimedBoardsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [filter, setFilter] = useState('');
  const { data, error, isLoading } = trpc.admin.unclaimedBoards.list.useQuery({ orgId });

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return data ?? [];
    return (data ?? []).filter((row) =>
      [row.realUuid, row.lastSeenAt ?? '', row.lastSignalPreview ?? ''].join(' ').toLowerCase().includes(q),
    );
  }, [data, filter]);

  if ((error as { data?: { code?: string } } | null)?.data?.code === 'FORBIDDEN') {
    return <div className="p-6 text-sm text-destructive">403 Forbidden</div>;
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Unclaimed Boards</h1>
      <input
        className="h-9 w-full max-w-md rounded-md border border-input bg-background px-3 py-1 text-sm"
        placeholder="Filter by UUID or signal preview"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left">
              <tr>
                <th className="px-3 py-2">realUuid</th>
                <th className="px-3 py-2">lastSeenAt</th>
                <th className="px-3 py-2">lastSignalPreview</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.realUuid} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">{row.realUuid}</td>
                  <td className="px-3 py-2">{row.lastSeenAt ?? '-'}</td>
                  <td className="px-3 py-2">{row.lastSignalPreview ?? '-'}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-muted-foreground" colSpan={3}>
                    No unclaimed boards.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

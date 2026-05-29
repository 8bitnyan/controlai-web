'use client';

/**
 * Read-only pill showing the current SiteGroup.topicSchemaMode.
 * Color-coded: legacy=gray, dual=amber, new=green.
 */
export function TopicSchemaPill({ mode = 'legacy' }: { mode?: 'legacy' | 'dual' | 'new' }) {
  const color =
    mode === 'new'
      ? 'bg-emerald-500/15 text-emerald-700 border-emerald-500/40'
      : mode === 'dual'
        ? 'bg-amber-500/15 text-amber-700 border-amber-500/40'
        : 'bg-zinc-500/15 text-zinc-700 border-zinc-500/40';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium ${color}`}
      title={`Topic schema mode: ${mode}`}
    >
      <span className="font-mono">{mode}</span>
    </span>
  );
}

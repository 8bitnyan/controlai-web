export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { runCleanupTick } = await import('./lib/cron/cleanup-failed-provisions');
  const { reconcileOrphans } = await import('./lib/cron/cleanup-failed-provisions');
  const { prisma } = await import('@controlai-web/db');

  const cleanupKey = Symbol.for('controlai.cleanup-failed-provisions.scheduled');
  if (!(globalThis as Record<symbol, boolean>)[cleanupKey]) {
    (globalThis as Record<symbol, boolean>)[cleanupKey] = true;
    const tick = () => {
      void runCleanupTick(prisma).catch((error) => {
        console.error('[cleanup-tick]', error);
      });
    };
    setInterval(tick, 60 * 60 * 1000);
    tick();
  }

  const orphanKey = Symbol.for('controlai.reconcile-orphans.scheduled');
  if ((globalThis as Record<symbol, boolean>)[orphanKey]) return;
  (globalThis as Record<symbol, boolean>)[orphanKey] = true;

  const orphanTick = () => {
    void reconcileOrphans(prisma).catch((error) => {
      console.error('[orphan-reconciliation-tick]', error);
    });
  };

  setInterval(orphanTick, 60 * 60 * 1000);
  orphanTick();
}

import type { PrismaClient } from '@controlai-web/db';

export interface ProgressLogEntry { ts: string; message: string }
export interface ProvisionProgress { stage: string; percent: number; log: ProgressLogEntry[] }

const MAX_LOG_ENTRIES = 50;

export async function updateProvisionProgress(
  prisma: PrismaClient,
  instanceId: string,
  patch: { stage: string; percent: number; message: string },
): Promise<void> {
  try {
    const row = await prisma.controlaiInstance.findUnique({ where: { id: instanceId }, select: { provisionProgress: true } });
    const current = (row?.provisionProgress as ProvisionProgress | null) ?? { stage: '', percent: 0, log: [] };
    const nextLog = [...current.log, { ts: new Date().toISOString(), message: patch.message }].slice(-MAX_LOG_ENTRIES);
    const next: ProvisionProgress = { stage: patch.stage, percent: patch.percent, log: nextLog };
    await prisma.controlaiInstance.update({ where: { id: instanceId }, data: { provisionProgress: next as unknown as object } });
  } catch (e) {
    console.warn('[provision-progress] update failed (non-fatal)', e);
  }
}



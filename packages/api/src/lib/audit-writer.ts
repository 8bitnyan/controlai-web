/**
 * Fire-and-forget audit log writer.
 * Failures are logged but NOT thrown — audit writes must not block mutations.
 */
import type { PrismaClient } from '@controlai-web/db';

export interface WriteAuditInput {
  orgId: string;
  userId?: string | null;
  action: string;
  targetId?: string | null;
  targetType?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function writeAudit(
  db: PrismaClient,
  input: WriteAuditInput,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        orgId: input.orgId,
        userId: input.userId ?? null,
        action: input.action,
        targetId: input.targetId ?? null,
        targetType: input.targetType ?? null,
        metadata: input.metadata ?? undefined,
      },
    });
  } catch (err) {
    // Audit write failure must not propagate
    console.error('[audit-writer] Failed to write audit log:', err);
  }
}

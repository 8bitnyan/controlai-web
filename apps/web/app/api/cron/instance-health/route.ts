import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { prisma } from '@controlai-web/db';
import { decryptToken, checkDaemonHealth, DaemonError } from '@controlai-web/api';

export const runtime = 'nodejs';
export const maxDuration = 55; // Vercel 60 s cron window

export async function GET(req: NextRequest) {
  // Secure the cron endpoint — requires correct CRON_SECRET header
  const cronSecret =
    req.headers.get('x-cron-secret') ??
    req.nextUrl.searchParams.get('cron_secret');
  if (cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const instances = await prisma.controlaiInstance.findMany({
    select: {
      id: true,
      baseURL: true,
      bearerTokenEnc: true,
      consecutiveFails: true,
    },
  });

  const results = await Promise.allSettled(
    instances.map(async (instance) => {
      try {
        const token = decryptToken(instance.bearerTokenEnc);
        const health = await checkDaemonHealth(instance.baseURL, token);

        await prisma.controlaiInstance.update({
          where: { id: instance.id },
          data: {
            status: 'HEALTHY',
            lastSeenAt: new Date(),
            version: health.version ?? null,
            capacityUsedMB: health.capacity?.used_mb ?? null,
            capacityAllowedMB: health.capacity?.allowed_mb ?? null,
            consecutiveFails: 0,
          },
        });

        return { id: instance.id, status: 'HEALTHY' };
      } catch (err) {
        const newFails = (instance.consecutiveFails ?? 0) + 1;
        // Three consecutive failures → UNREACHABLE
        const newStatus = newFails >= 3 ? ('UNREACHABLE' as const) : ('DEGRADED' as const);

        await prisma.controlaiInstance.update({
          where: { id: instance.id },
          data: {
            status: newStatus,
            consecutiveFails: newFails,
          },
        });

        return {
          id: instance.id,
          status: newStatus,
          error: err instanceof DaemonError ? err.message : String(err),
        };
      }
    }),
  );

  const summary = results.map((r) =>
    r.status === 'fulfilled' ? r.value : { error: String(r.reason) },
  );

  return NextResponse.json({ polled: instances.length, results: summary });
}

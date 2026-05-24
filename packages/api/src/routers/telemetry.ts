import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router, orgProcedure } from '../trpc';
import { callDaemon } from '../lib/daemon-client';

const UPSTASH_REDIS_URL = process.env.UPSTASH_REDIS_URL;
const UPSTASH_REDIS_TOKEN = process.env.UPSTASH_REDIS_TOKEN;

/**
 * Minimal Upstash Redis REST client helper.
 * Sends commands as HTTP requests to the Upstash REST API.
 */
async function redisXRange(
  key: string,
  start: string,
  end: string,
  count: number,
): Promise<Array<[string, string[]]>> {
  if (!UPSTASH_REDIS_URL || !UPSTASH_REDIS_TOKEN) {
    return [];
  }

  const url = `${UPSTASH_REDIS_URL}/xrange/${encodeURIComponent(key)}/${encodeURIComponent(start)}/${encodeURIComponent(end)}?count=${count}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${UPSTASH_REDIS_TOKEN}` },
  });

  if (!response.ok) return [];

  const json = (await response.json()) as { result?: Array<[string, string[]]> };
  return json.result ?? [];
}

export const telemetryRouter = router({
  /**
   * Read the last N MQTT messages for a site from Upstash Redis Streams.
   */
  recent: orgProcedure
    .input(
      z.object({
        orgId: z.string().cuid(),
        siteId: z.string().cuid(),
        topic: z.string().default('#'),
        n: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Verify site belongs to org
      const site = await ctx.prisma.site.findFirst({
        where: { id: input.siteId, siteGroup: { project: { orgId: ctx.orgId! } } },
      });
      if (!site) throw new TRPCError({ code: 'FORBIDDEN' });

      const streamKey = `${input.siteId}:${input.topic}`;
      const entries = await redisXRange(streamKey, '-', '+', input.n);

      const messages = entries.map(([id, fields]) => {
        const fieldMap: Record<string, string> = {};
        for (let i = 0; i < fields.length - 1; i += 2) {
          fieldMap[fields[i]!] = fields[i + 1]!;
        }
        let payload: unknown = fieldMap.payload;
        try {
          payload = JSON.parse(fieldMap.payload ?? '{}');
        } catch {
          // keep as string
        }
        return {
          id,
          timestamp: fieldMap.timestamp ?? new Date().toISOString(),
          topic: input.topic,
          payload,
        };
      });

      // Return newest first
      return { messages: messages.reverse() };
    }),

  /**
   * Fetch historical telemetry from daemon TimescaleDB (range query).
   * Returns raw rows; placeholder for future daemon tsdb query endpoint.
   */
  range: orgProcedure
    .input(
      z.object({
        orgId: z.string().cuid(),
        siteId: z.string().cuid(),
        start: z.string().datetime(),
        end: z.string().datetime(),
        topic: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const site = await ctx.prisma.site.findFirst({
        where: { id: input.siteId, siteGroup: { project: { orgId: ctx.orgId! } } },
        include: {
          siteGroup: { include: { project: { include: { instance: true } } } },
        },
      });
      if (!site) throw new TRPCError({ code: 'FORBIDDEN' });

      if (!site.controlaiTenantId) {
        // Not provisioned yet — return empty
        return { rows: [] };
      }

      try {
        const rows = await callDaemon<unknown[]>(
          site.siteGroup.project.instance,
          `/v1/tenants/${site.controlaiTenantId}/tsdb/query`,
          {
            method: 'POST',
            body: JSON.stringify({
              start: input.start,
              end: input.end,
              topic: input.topic,
            }),
          },
        );
        return { rows: rows ?? [] };
      } catch {
        // Daemon may not support this endpoint yet
        return { rows: [] };
      }
    }),
});

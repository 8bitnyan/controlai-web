import { z } from 'zod';

/**
 * NormalizedMessage — the canonical wire format on Redis Streams + SSE.
 * deviceKey is the operational routing key (the cross-spec invariant).
 */
export const NormalizedMessageSchema = z.object({
  deviceKey: z.string().cuid(),
  dataType: z.enum(['birth', 'data', 'death', 'cmd']),
  payload: z.unknown(),
  ts: z.string().datetime(),
  sourceTopic: z.string().optional(),
  sourceDriver: z.string(),
});

export type NormalizedMessage = z.infer<typeof NormalizedMessageSchema>;

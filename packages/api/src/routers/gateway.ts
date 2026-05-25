import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { SignJWT } from 'jose';
import { router, orgProcedure } from '../trpc';
import { writeAudit } from '../lib/audit-writer';
import { encryptToken, decryptToken } from '../lib/crypto';
import { callDaemon } from '../lib/daemon-client';
import { simStart, simStop, simStatus, SimulatorError } from '../lib/simulator-client';
import type { GatewayDTO, SensorConfig } from '@controlai-web/shared-types';

const STREAM_JWT_SECRET_RAW = process.env.STREAM_JWT_SECRET;
const SIMULATOR_PUBLIC_URL =
  process.env.SIMULATOR_PUBLIC_URL ?? 'http://localhost:4001';

const SensorConfigSchema = z.object({
  id: z.string(),
  type: z.enum(['temperature', 'pressure', 'humidity', 'vibration']),
  min: z.number(),
  max: z.number(),
  walkStep: z.number().positive(),
  intervalMs: z.number().int().min(100),
  unit: z.string().optional(),
  seed: z.number().int().optional(),
});

const BaseGatewayInput = z.object({
  orgId: z.string().cuid(),
  label: z.string().min(1).max(128),
  kind: z.enum(['simulator', 'physical']),
  mode: z.enum(['cbor-modules-cloud', 'json']),
  endpointURL: z.string().url(),
  groupId: z.string().min(1),
  clientId: z.string().min(1),
  rootCaPem: z.string().min(1),
  clientCertPem: z.string().min(1),
  clientKeyPem: z.string().min(1),
  sensors: z.array(SensorConfigSchema).default([]),
  jsonTopicTemplate: z.string().optional(),
});

/** Map a Prisma Gateway row to a GatewayDTO (no PEM fields). */
function toDTO(row: {
  id: string;
  siteGroupId: string;
  label: string;
  kind: string;
  mode: string;
  endpointURL: string;
  groupId: string;
  clientId: string;
  sensors: unknown;
  jsonTopicTemplate: string | null;
  desiredState: string;
  lastStatus: string;
  lastError: string | null;
}): GatewayDTO {
  return {
    id: row.id,
    siteGroupId: row.siteGroupId,
    label: row.label,
    kind: row.kind as GatewayDTO['kind'],
    mode: row.mode as GatewayDTO['mode'],
    endpointURL: row.endpointURL,
    groupId: row.groupId,
    clientId: row.clientId,
    sensors: row.sensors as SensorConfig[],
    jsonTopicTemplate: row.jsonTopicTemplate,
    desiredState: row.desiredState as GatewayDTO['desiredState'],
    lastStatus: row.lastStatus as GatewayDTO['lastStatus'],
    lastError: row.lastError,
  };
}

export const gatewayRouter = router({
  /** List all gateways for a siteGroup. */
  list: orgProcedure
    .input(z.object({ orgId: z.string().cuid(), siteGroupId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const sg = await ctx.prisma.siteGroup.findFirst({
        where: { id: input.siteGroupId, project: { orgId: ctx.orgId! } },
      });
      if (!sg) throw new TRPCError({ code: 'FORBIDDEN' });

      const rows = await ctx.prisma.gateway.findMany({
        where: { siteGroupId: input.siteGroupId },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map(toDTO);
    }),

  /** Get a single gateway. */
  get: orgProcedure
    .input(z.object({ orgId: z.string().cuid(), gatewayId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.prisma.gateway.findFirst({
        where: {
          id: input.gatewayId,
          siteGroup: { project: { orgId: ctx.orgId! } },
        },
      });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return toDTO(row);
    }),

  /** Create a new gateway row. */
  create: orgProcedure
    .input(BaseGatewayInput.extend({ siteGroupId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const sg = await ctx.prisma.siteGroup.findFirst({
        where: { id: input.siteGroupId, project: { orgId: ctx.orgId! } },
      });
      if (!sg) throw new TRPCError({ code: 'FORBIDDEN' });

      const row = await ctx.prisma.gateway.create({
        data: {
          siteGroupId: input.siteGroupId,
          label: input.label,
          kind: input.kind,
          mode: input.mode,
          endpointURL: input.endpointURL,
          groupId: input.groupId,
          clientId: input.clientId,
          rootCaPemEnc: encryptToken(input.rootCaPem),
          clientCertPemEnc: encryptToken(input.clientCertPem),
          clientKeyPemEnc: encryptToken(input.clientKeyPem),
          sensors: input.sensors,
          jsonTopicTemplate: input.jsonTopicTemplate ?? null,
        },
      });

      void writeAudit(ctx.prisma, {
        orgId: ctx.orgId!,
        userId: ctx.userId,
        action: 'gateway.create',
        targetId: row.id,
        targetType: 'Gateway',
        metadata: { label: row.label, kind: row.kind, mode: row.mode },
      });

      return toDTO(row);
    }),

  /** Update a gateway. Refuses PEM/endpoint changes when running. */
  update: orgProcedure
    .input(
      z.object({
        orgId: z.string().cuid(),
        gatewayId: z.string().cuid(),
        label: z.string().min(1).max(128).optional(),
        endpointURL: z.string().url().optional(),
        groupId: z.string().min(1).optional(),
        clientId: z.string().min(1).optional(),
        rootCaPem: z.string().min(1).optional(),
        clientCertPem: z.string().min(1).optional(),
        clientKeyPem: z.string().min(1).optional(),
        sensors: z.array(SensorConfigSchema).optional(),
        jsonTopicTemplate: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.prisma.gateway.findFirst({
        where: { id: input.gatewayId, siteGroup: { project: { orgId: ctx.orgId! } } },
      });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });

      const isRunning = row.lastStatus !== 'stopped';
      const credChange =
        input.endpointURL !== undefined ||
        input.rootCaPem !== undefined ||
        input.clientCertPem !== undefined ||
        input.clientKeyPem !== undefined;

      if (isRunning && credChange) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot change credentials or endpoint while gateway is running. Stop it first.',
        });
      }

      const updated = await ctx.prisma.gateway.update({
        where: { id: input.gatewayId },
        data: {
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.endpointURL !== undefined ? { endpointURL: input.endpointURL } : {}),
          ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
          ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
          ...(input.rootCaPem !== undefined ? { rootCaPemEnc: encryptToken(input.rootCaPem) } : {}),
          ...(input.clientCertPem !== undefined ? { clientCertPemEnc: encryptToken(input.clientCertPem) } : {}),
          ...(input.clientKeyPem !== undefined ? { clientKeyPemEnc: encryptToken(input.clientKeyPem) } : {}),
          ...(input.sensors !== undefined ? { sensors: input.sensors } : {}),
          ...(input.jsonTopicTemplate !== undefined ? { jsonTopicTemplate: input.jsonTopicTemplate } : {}),
        },
      });

      return toDTO(updated);
    }),

  /** Delete a gateway. Stops it first if running (NDEATH published by simulator). */
  delete: orgProcedure
    .input(z.object({ orgId: z.string().cuid(), gatewayId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.prisma.gateway.findFirst({
        where: { id: input.gatewayId, siteGroup: { project: { orgId: ctx.orgId! } } },
      });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });

      // If running, stop first (simulator publishes NDEATH for cbor gateways)
      if (row.lastStatus !== 'stopped') {
        try {
          await simStop(row.id);
        } catch (err) {
          const msg = err instanceof SimulatorError ? err.message : String(err);
          console.warn(`[gateway.delete] Failed to stop gateway ${row.id}: ${msg}`);
        }
        await ctx.prisma.gateway.update({
          where: { id: row.id },
          data: { desiredState: 'stopped', lastStatus: 'stopped' },
        });
      }

      await ctx.prisma.gateway.delete({ where: { id: input.gatewayId } });

      void writeAudit(ctx.prisma, {
        orgId: ctx.orgId!,
        userId: ctx.userId,
        action: 'gateway.delete',
        targetId: row.id,
        targetType: 'Gateway',
        metadata: { label: row.label },
      });

      return { success: true };
    }),

  /**
   * Issue certs from the controlai daemon PKI endpoint.
   * The siteId must belong to this siteGroup and have controlaiTenantId + controlaiSiteId.
   */
  issueFromDaemon: orgProcedure
    .input(
      z.object({
        orgId: z.string().cuid(),
        gatewayId: z.string().cuid(),
        siteId: z.string().cuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const gw = await ctx.prisma.gateway.findFirst({
        where: { id: input.gatewayId, siteGroup: { project: { orgId: ctx.orgId! } } },
      });
      if (!gw) throw new TRPCError({ code: 'NOT_FOUND' });

      if (gw.lastStatus !== 'stopped') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Stop the gateway before re-issuing credentials.',
        });
      }

      // Find the site and its associated daemon instance
      const site = await ctx.prisma.site.findFirst({
        where: {
          id: input.siteId,
          siteGroup: { project: { orgId: ctx.orgId! } },
        },
        include: { siteGroup: { include: { project: { include: { instance: true } } } } },
      });
      if (!site) throw new TRPCError({ code: 'NOT_FOUND', message: 'Site not found' });

      if (!site.controlaiTenantId || !site.controlaiSiteId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Site must be provisioned (Apply) before issuing gateway certs.',
        });
      }

      const instance = site.siteGroup.project.instance;

      // Call PKI cert endpoint: POST /v1/tenants/{tid}/sites/{sid}/pki/certs
      interface PkiCertResponse {
        cert_pem: string;
        key_pem: string;
        fingerprint: string;
        not_after: string;
        ca_pem?: string;
      }

      const pkiPath = `/v1/tenants/${site.controlaiTenantId}/sites/${site.controlaiSiteId}/pki/certs`;
      let certResp: PkiCertResponse;
      try {
        certResp = await callDaemon<PkiCertResponse>(instance, pkiPath, {
          method: 'POST',
          body: JSON.stringify({ gateway: gw.groupId }),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Daemon PKI error: ${msg}` });
      }

      if (!certResp.cert_pem || !certResp.key_pem) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Daemon did not return cert_pem/key_pem',
        });
      }

      // Fetch root CA if not included in cert response
      let rootCaPem = certResp.ca_pem ?? null;
      if (!rootCaPem) {
        const caPath = `/v1/tenants/${site.controlaiTenantId}/pki/ca`;
        try {
          const caResp = await callDaemon<{ ca_pem: string }>(instance, caPath);
          rootCaPem = caResp.ca_pem;
        } catch {
          // If no CA endpoint, we can't update rootCa; caller must supply manually
          rootCaPem = decryptToken(gw.rootCaPemEnc); // keep existing
        }
      }

      await ctx.prisma.gateway.update({
        where: { id: gw.id },
        data: {
          rootCaPemEnc: encryptToken(rootCaPem),
          clientCertPemEnc: encryptToken(certResp.cert_pem),
          clientKeyPemEnc: encryptToken(certResp.key_pem),
        },
      });

      void writeAudit(ctx.prisma, {
        orgId: ctx.orgId!,
        userId: ctx.userId,
        action: 'gateway.issueFromDaemon',
        targetId: gw.id,
        targetType: 'Gateway',
        metadata: { fingerprint: certResp.fingerprint },
      });

      return {
        fingerprint: certResp.fingerprint,
        not_after: certResp.not_after,
      };
    }),

  /**
   * Preview-issue PEMs from the daemon WITHOUT persisting to a Gateway row.
   * Used by the create flow so user can pre-fill the 3 textareas before saving.
   * Picks the first Site of the SiteGroup (matches Apply's behavior).
   */
  previewIssueFromDaemon: orgProcedure
    .input(
      z.object({
        orgId: z.string().cuid(),
        siteGroupId: z.string().cuid(),
        gatewayCN: z.string().min(1).max(63),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const site = await ctx.prisma.site.findFirst({
        where: {
          siteGroupId: input.siteGroupId,
          siteGroup: { project: { orgId: ctx.orgId! } },
        },
        include: { siteGroup: { include: { project: { include: { instance: true } } } } },
      });
      if (!site) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No site found in this SiteGroup' });
      }
      if (!site.controlaiTenantId || !site.controlaiSiteId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Site must be provisioned (Apply) before issuing gateway certs.',
        });
      }

      interface PkiCertResponse {
        cert_pem: string;
        key_pem: string;
        fingerprint: string;
        not_after: string;
        ca_pem?: string;
      }

      const instance = site.siteGroup.project.instance;
      const pkiPath = `/v1/tenants/${site.controlaiTenantId}/sites/${site.controlaiSiteId}/pki/certs`;
      let certResp: PkiCertResponse;
      try {
        certResp = await callDaemon<PkiCertResponse>(instance, pkiPath, {
          method: 'POST',
          body: JSON.stringify({ gateway: input.gatewayCN }),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Daemon PKI error: ${msg}` });
      }
      if (!certResp.cert_pem || !certResp.key_pem) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Daemon did not return cert_pem/key_pem',
        });
      }

      let rootCaPem = certResp.ca_pem ?? '';
      if (!rootCaPem) {
        const caPath = `/v1/tenants/${site.controlaiTenantId}/pki/ca`;
        try {
          const caResp = await callDaemon<{ ca_pem: string }>(instance, caPath);
          rootCaPem = caResp.ca_pem;
        } catch {
          // CA endpoint absent — return blank so user can paste manually
          rootCaPem = '';
        }
      }

      return {
        rootCaPem,
        clientCertPem: certResp.cert_pem,
        clientKeyPem: certResp.key_pem,
        fingerprint: certResp.fingerprint,
        notAfter: certResp.not_after,
      };
    }),

  /** Start a gateway — sets desiredState=running and forwards to simulator. */
  start: orgProcedure
    .input(z.object({ orgId: z.string().cuid(), gatewayId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const gw = await ctx.prisma.gateway.findFirst({
        where: { id: input.gatewayId, siteGroup: { project: { orgId: ctx.orgId! } } },
      });
      if (!gw) throw new TRPCError({ code: 'NOT_FOUND' });

      await ctx.prisma.gateway.update({
        where: { id: input.gatewayId },
        data: { desiredState: 'running' },
      });

      try {
        await simStart(input.gatewayId);
      } catch (err) {
        const msg = err instanceof SimulatorError ? err.message : String(err);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Simulator error: ${msg}` });
      }

      return { ok: true };
    }),

  /** Stop a gateway — sets desiredState=stopped and forwards to simulator. */
  stop: orgProcedure
    .input(z.object({ orgId: z.string().cuid(), gatewayId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const gw = await ctx.prisma.gateway.findFirst({
        where: { id: input.gatewayId, siteGroup: { project: { orgId: ctx.orgId! } } },
      });
      if (!gw) throw new TRPCError({ code: 'NOT_FOUND' });

      await ctx.prisma.gateway.update({
        where: { id: input.gatewayId },
        data: { desiredState: 'stopped' },
      });

      try {
        await simStop(input.gatewayId);
      } catch (err) {
        const msg = err instanceof SimulatorError ? err.message : String(err);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Simulator error: ${msg}` });
      }

      return { ok: true };
    }),

  /** Get live status from the simulator. Falls back to DB on error. */
  status: orgProcedure
    .input(z.object({ orgId: z.string().cuid(), gatewayId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const gw = await ctx.prisma.gateway.findFirst({
        where: { id: input.gatewayId, siteGroup: { project: { orgId: ctx.orgId! } } },
      });
      if (!gw) throw new TRPCError({ code: 'NOT_FOUND' });

      try {
        const liveStatus = await simStatus(input.gatewayId);
        return { gatewayId: input.gatewayId, ...liveStatus, source: 'live' as const };
      } catch {
        return {
          gatewayId: input.gatewayId,
          status: gw.lastStatus,
          connected: gw.lastStatus === 'connected',
          source: 'db' as const,
        };
      }
    }),

  /**
   * Mint a short-lived JWT for browser → simulator SSE access.
   * Returns { token, outboxUrl, eventsUrl }.
   */
  streamToken: orgProcedure
    .input(z.object({ orgId: z.string().cuid(), gatewayId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!STREAM_JWT_SECRET_RAW) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'STREAM_JWT_SECRET not configured' });
      }

      const gw = await ctx.prisma.gateway.findFirst({
        where: { id: input.gatewayId, siteGroup: { project: { orgId: ctx.orgId! } } },
      });
      if (!gw) throw new TRPCError({ code: 'NOT_FOUND' });

      const secret = new TextEncoder().encode(STREAM_JWT_SECRET_RAW);
      const now = Math.floor(Date.now() / 1000);
      const exp = now + 300; // 5 minutes

      const token = await new SignJWT({
        gatewayId: input.gatewayId,
        kind: 'outbox',
        userId: ctx.userId,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt(now)
        .setExpirationTime(exp)
        .sign(secret);

      const base = SIMULATOR_PUBLIC_URL.replace(/\/$/, '');
      return {
        token,
        outboxUrl: `${base}/gateways/${input.gatewayId}/outbox`,
        eventsUrl: `${base}/events`,
      };
    }),
});

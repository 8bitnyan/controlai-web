// See openspec/changes/add-gateway-board-provisioning/ for the board provisioning capability spec.
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { SignJWT } from 'jose';
import { router, orgProcedure } from '../trpc';
import { writeAudit } from '../lib/audit-writer';
import { encryptToken, decryptToken } from '../lib/crypto';
import { callDaemon } from '../lib/daemon-client';
import { simStart, simStop, simStatus, SimulatorError } from '../lib/simulator-client';
import { pemToHexChunks } from '../lib/pem-to-hex';
import { BOARD_PROVISION_SEQUENCE } from '../lib/board-cli-spec';
import type { GatewayDTO, SensorConfig, DetectBrokerEndpointResult } from '@controlai-web/shared-types';
import type { DiscoveredChild, MatchPlan, RegistrationDecisions } from '@controlai-web/shared-types';
import { proposeRegistrationMatch } from '../lib/registration-matcher';
import { revokeCert } from '../lib/daemon-cert-revoke';
import { appendNodeToNodeConfig } from '../lib/nodeconfig-internal';

const REGISTRATION_ACTIONS = ['gateway.register-start', 'gateway.register-proposed', 'gateway.register-success', 'gateway.register-failed', 'gateway.register-aborted', 'gateway.re-register-start', 'gateway.register-expired'] as const;

function recordRegistrationAudit(
  prisma: unknown,
  payload: { orgId: string; userId: string | null; action: (typeof REGISTRATION_ACTIONS)[number]; targetId: string; metadata: Record<string, unknown> },
): void {
  void writeAudit(prisma as never, {
    orgId: payload.orgId,
    userId: payload.userId,
    action: payload.action,
    targetId: payload.targetId,
    targetType: 'Gateway',
    metadata: payload.metadata,
  });
}

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
  tlsServername: z.string().optional(),
  brokerHost: z.string().optional(),
  brokerPort: z.number().int().min(1).max(65535).optional(),
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
  tlsServername: string | null;
  brokerHost: string | null;
  brokerPort: number | null;
  groupId: string;
  clientId: string;
  sensors: unknown;
  jsonTopicTemplate: string | null;
  desiredState: string;
  lastStatus: string;
  lastError: string | null;
  rootCaPemEnc: string | null;
  clientCertPemEnc: string | null;
  clientKeyPemEnc: string | null;
}): GatewayDTO {
  return {
    id: row.id,
    siteGroupId: row.siteGroupId,
    label: row.label,
    kind: row.kind as GatewayDTO['kind'],
    mode: row.mode as GatewayDTO['mode'],
    endpointURL: row.endpointURL,
    tlsServername: row.tlsServername,
    brokerHost: row.brokerHost,
    brokerPort: row.brokerPort,
    groupId: row.groupId,
    clientId: row.clientId,
    sensors: row.sensors as SensorConfig[],
    jsonTopicTemplate: row.jsonTopicTemplate,
    desiredState: row.desiredState as GatewayDTO['desiredState'],
    lastStatus: row.lastStatus as GatewayDTO['lastStatus'],
    lastError: row.lastError,
    hasCerts: !!row.rootCaPemEnc && !!row.clientCertPemEnc && !!row.clientKeyPemEnc,
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
          tlsServername: input.tlsServername ?? null,
          brokerHost: input.brokerHost ?? null,
          brokerPort: input.brokerPort ?? null,
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
        tlsServername: z.string().nullable().optional(),
        brokerHost: z.string().nullable().optional(),
        brokerPort: z.number().int().min(1).max(65535).nullable().optional(),
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

      const previousRow = await ctx.prisma.gateway.findUniqueOrThrow({
        where: { id: input.gatewayId },
        select: { clientId: true },
      });
      const previousClientId = previousRow.clientId;
      const updated = await ctx.prisma.gateway.update({
        where: { id: input.gatewayId },
        data: {
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.endpointURL !== undefined ? { endpointURL: input.endpointURL } : {}),
          ...(input.tlsServername !== undefined
            ? { tlsServername: input.tlsServername === '' ? null : input.tlsServername }
            : {}),
          ...(input.brokerHost !== undefined
            ? { brokerHost: input.brokerHost === '' ? null : input.brokerHost }
            : {}),
          ...(input.brokerPort !== undefined ? { brokerPort: input.brokerPort } : {}),
          ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
          ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
          ...(input.rootCaPem !== undefined ? { rootCaPemEnc: encryptToken(input.rootCaPem) } : {}),
          ...(input.clientCertPem !== undefined ? { clientCertPemEnc: encryptToken(input.clientCertPem) } : {}),
          ...(input.clientKeyPem !== undefined ? { clientKeyPemEnc: encryptToken(input.clientKeyPem) } : {}),
          ...(input.sensors !== undefined ? { sensors: input.sensors } : {}),
          ...(input.jsonTopicTemplate !== undefined ? { jsonTopicTemplate: input.jsonTopicTemplate } : {}),
        },
      });

      // Invalidate topic-translator cache when clientId changed so stale Prisma
      // clientId→deviceKey lookups are not served.
      if (input.clientId !== undefined && input.clientId !== previousClientId) {
        try {
          const { invalidateClientIdCache } = await import('@controlai-web/runtime-drivers');
          invalidateClientIdCache(previousClientId);
        } catch {
          // runtime-drivers may not be wired in some environments; safe to swallow.
        }
      }

      return toDTO(updated);
    }),

  detectBrokerEndpoint: orgProcedure
    .input(z.object({ orgId: z.string().cuid(), siteGroupId: z.string().cuid() }))
    .query(async ({ ctx, input }): Promise<DetectBrokerEndpointResult> => {
      const site = await ctx.prisma.site.findFirst({
        where: {
          siteGroupId: input.siteGroupId,
          siteGroup: { project: { orgId: ctx.orgId! } },
        },
        include: { siteGroup: { include: { project: { include: { instance: true } } } } },
      });
      if (!site || !site.controlaiTenantId || !site.controlaiSiteId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No provisioned site found in this SiteGroup' });
      }

      const tenant = await callDaemon<{ Domain?: string; domain?: string }>(
        site.siteGroup.project.instance,
        `/v1/tenants/${site.controlaiTenantId}`,
      );
      const domain = (tenant.Domain ?? tenant.domain ?? '').trim();
      if (!domain) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tenant domain is empty' });
      }

      const brokerHost = new URL(site.siteGroup.project.instance.baseURL).hostname;
      const brokerPort = 8883;
      const tlsServername = `${site.controlaiSiteId}.${site.controlaiTenantId}.${domain}`;
      return {
        brokerHost,
        brokerPort,
        tlsServername,
        endpointURL: `mqtts://${brokerHost}:${brokerPort}`,
      };
    }),

  detectBrokerEndpointForSite: orgProcedure
    .input(z.object({ orgId: z.string().cuid(), siteId: z.string().cuid() }))
    .query(async ({ ctx, input }): Promise<DetectBrokerEndpointResult> => {
      const site = await ctx.prisma.site.findFirst({
        where: {
          id: input.siteId,
          siteGroup: { project: { orgId: ctx.orgId! } },
        },
        include: { siteGroup: { include: { project: { include: { instance: true } } } } },
      });
      if (!site || !site.controlaiTenantId || !site.controlaiSiteId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Provisioned site not found' });
      }

      const tenant = await callDaemon<{ Domain?: string; domain?: string }>(
        site.siteGroup.project.instance,
        `/v1/tenants/${site.controlaiTenantId}`,
      );
      const domain = (tenant.Domain ?? tenant.domain ?? '').trim();
      if (!domain) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tenant domain is empty' });
      }

      const brokerHost = new URL(site.siteGroup.project.instance.baseURL).hostname;
      const brokerPort = 8883;
      const tlsServername = `${site.controlaiSiteId}.${site.controlaiTenantId}.${domain}`;
      return {
        brokerHost,
        brokerPort,
        tlsServername,
        endpointURL: `mqtts://${brokerHost}:${brokerPort}`,
      };
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

  getProvisioningBundle: orgProcedure
    .input(z.object({ orgId: z.string().cuid(), gatewayId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      void BOARD_PROVISION_SEQUENCE;
      const gw = await ctx.prisma.gateway.findFirst({
        where: { id: input.gatewayId },
        include: { siteGroup: { include: { project: true } } },
      });
      if (!gw || gw.siteGroup.project.orgId !== ctx.orgId) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      void writeAudit(ctx.prisma, {
        orgId: ctx.orgId!,
        userId: ctx.userId,
        action: 'gateway.provision-start',
        targetId: input.gatewayId,
        targetType: 'Gateway',
        metadata: { gatewayId: input.gatewayId, outcome: 'INITIATED' },
      });

      if (!gw.rootCaPemEnc || !gw.clientCertPemEnc || !gw.clientKeyPemEnc) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            '인증서가 아직 발급되지 않았습니다. 게이트웨이 편집에서 cert 발급 또는 수동 입력을 먼저 수행하세요.',
        });
      }

      const rootCaHex = pemToHexChunks(decryptToken(gw.rootCaPemEnc), 400);
      const clientCertHex = pemToHexChunks(decryptToken(gw.clientCertPemEnc), 400);
      const clientKeyHex = pemToHexChunks(decryptToken(gw.clientKeyPemEnc), 400);

      return {
        groupId: gw.groupId,
        endpointURL: gw.endpointURL,
        rootCaHex,
        clientCertHex,
        clientKeyHex,
      };
    }),

  recordProvisionSuccess: orgProcedure
    .input(
      z.object({
        orgId: z.string().cuid(),
        gatewayId: z.string().cuid(),
        deviceSerial: z.string().optional(),
        durationMs: z.number().int().nonnegative(),
        completedSteps: z.array(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const gw = await ctx.prisma.gateway.findFirst({
        where: { id: input.gatewayId },
        include: { siteGroup: { include: { project: true } } },
      });
      if (!gw || gw.siteGroup.project.orgId !== ctx.orgId) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      await ctx.prisma.gateway.update({
        where: { id: input.gatewayId },
        data: {
          lastProvisionedDeviceSerial: input.deviceSerial ?? null,
          lastProvisionedAt: new Date(),
        },
      });

      void writeAudit(ctx.prisma, {
        orgId: ctx.orgId!,
        userId: ctx.userId,
        action: 'gateway.provision-success',
        targetId: input.gatewayId,
        targetType: 'Gateway',
        metadata: {
          gatewayId: input.gatewayId,
          deviceSerial: input.deviceSerial ?? 'unknown',
          durationMs: input.durationMs,
          completedSteps: input.completedSteps,
          outcome: 'SUCCESS',
        },
      });

      return { ok: true as const };
    }),

  recordProvisionFailure: orgProcedure
    .input(
      z.object({
        orgId: z.string().cuid(),
        gatewayId: z.string().cuid(),
        deviceSerial: z.string().optional(),
        durationMs: z.number().int().nonnegative(),
        stepReached: z.string(),
        failureReason: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const gw = await ctx.prisma.gateway.findFirst({
        where: { id: input.gatewayId },
        include: { siteGroup: { include: { project: true } } },
      });
      if (!gw || gw.siteGroup.project.orgId !== ctx.orgId) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      void writeAudit(ctx.prisma, {
        orgId: ctx.orgId!,
        userId: ctx.userId,
        action: 'gateway.provision-failed',
        targetId: input.gatewayId,
        targetType: 'Gateway',
        metadata: {
          gatewayId: input.gatewayId,
          deviceSerial: input.deviceSerial ?? 'unknown',
          durationMs: input.durationMs,
          stepReached: input.stepReached,
          failureReason: input.failureReason,
          outcome: 'FAILURE',
        },
      });

      return { ok: true as const };
    }),

  beginRegistration: orgProcedure
    .input(z.object({ orgId: z.string().cuid(), gatewayDeviceKey: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.$transaction(async (tx) => {
        const gateway = await tx.device.findUnique({ where: { deviceKey: input.gatewayDeviceKey } });
        if (!gateway) throw new TRPCError({ code: 'NOT_FOUND' });
        const now = new Date();
        const existing = await tx.registrationProposal.findFirst({ where: { gatewayDeviceKey: input.gatewayDeviceKey, state: 'PROPOSED', expiresAt: { gt: now } }, orderBy: { createdAt: 'desc' } });
        if (existing) return { registrationSessionId: existing.id, resumed: true };

        await tx.device.updateMany({ where: { OR: [{ deviceKey: gateway.deviceKey }, { parentDeviceKey: gateway.deviceKey }] }, data: { registrationState: 'REGISTERING' } });
        const proposal = await tx.registrationProposal.create({ data: { gatewayDeviceKey: gateway.deviceKey, state: 'PROPOSED', boardReportedUuid: '', discoveredChildrenJson: [], expiresAt: new Date(now.getTime() + 30 * 60 * 1000) } });
        recordRegistrationAudit(tx, { orgId: ctx.orgId!, userId: ctx.userId, action: 'gateway.register-start', targetId: gateway.deviceKey, metadata: { gatewayDeviceKey: gateway.deviceKey, registrationSessionId: proposal.id } });
        return { registrationSessionId: proposal.id, resumed: false };
      });
    }),

  proposeRegistration: orgProcedure
    .input(z.object({ orgId: z.string().cuid(), registrationSessionId: z.string().cuid(), boardReportedUuid: z.string(), discoveredChildren: z.array(z.custom<DiscoveredChild>()) }))
    .mutation(async ({ ctx, input }) => {
      const proposal = await ctx.prisma.registrationProposal.findUnique({ where: { id: input.registrationSessionId } });
      if (!proposal || proposal.state !== 'PROPOSED' || proposal.expiresAt < new Date()) throw new TRPCError({ code: 'PRECONDITION_FAILED' });
      const shadows = await ctx.prisma.device.findMany({ where: { parentDeviceKey: proposal.gatewayDeviceKey } });
      const lastKnown = await ctx.prisma.registrationProposal.findFirst({ where: { gatewayDeviceKey: proposal.gatewayDeviceKey, state: 'COMMITTED' }, orderBy: { committedAt: 'desc' } });
      const matchPlan = proposeRegistrationMatch(shadows, input.discoveredChildren, (lastKnown?.userDecisionsJson as RegistrationDecisions | null) ?? null);
      await ctx.prisma.registrationProposal.update({ where: { id: proposal.id }, data: { boardReportedUuid: input.boardReportedUuid, discoveredChildrenJson: input.discoveredChildren, matchPlanJson: matchPlan } });
      recordRegistrationAudit(ctx.prisma, { orgId: ctx.orgId!, userId: ctx.userId, action: 'gateway.register-proposed', targetId: proposal.gatewayDeviceKey, metadata: { gatewayDeviceKey: proposal.gatewayDeviceKey, registrationSessionId: proposal.id } });
      return { matchPlan, expiresAt: proposal.expiresAt };
    }),

  commitRegistration: orgProcedure
    .input(z.object({ orgId: z.string().cuid(), registrationSessionId: z.string().cuid(), decisions: z.custom<RegistrationDecisions>(), mode: z.enum(['new', 're-register']).optional() }))
    .mutation(async ({ ctx, input }) => {
      const proposal = await ctx.prisma.registrationProposal.findUnique({ where: { id: input.registrationSessionId } });
      if (!proposal || proposal.state !== 'PROPOSED' || proposal.expiresAt < new Date()) throw new TRPCError({ code: 'PRECONDITION_FAILED' });
      const matchPlan = proposal.matchPlanJson as MatchPlan | null;
      if (!matchPlan || matchPlan.unknownTypes.length > 0) throw new TRPCError({ code: 'PRECONDITION_FAILED' });

      const gw = await ctx.prisma.device.findUnique({ where: { deviceKey: proposal.gatewayDeviceKey } });
      if (!gw) throw new TRPCError({ code: 'NOT_FOUND' });

      if (input.mode === 're-register') {
        const revoke = await revokeCert({ tenantId: gw.siteGroupId, fingerprint: gw.realUuid ?? '' });
        if (!revoke.ok) console.warn('[gateway.re-register] revoke failed', revoke.message);
        recordRegistrationAudit(ctx.prisma, { orgId: ctx.orgId!, userId: ctx.userId, action: 'gateway.re-register-start', targetId: gw.deviceKey, metadata: { gatewayDeviceKey: gw.deviceKey, registrationSessionId: proposal.id } });
      }

      await ctx.prisma.$transaction(async (tx) => {
        await tx.device.update({ where: { deviceKey: gw.deviceKey }, data: { realUuid: matchPlan.gatewayMatch.boardReportedUuid, registrationState: 'REGISTERED', simulationDesired: false, registeredAt: new Date(), registeredByUserId: ctx.userId } });

        for (const confirmed of input.decisions.confirmedMatches) {
          const child = matchPlan.confirmedMatches.find((m) => m.shadowDeviceKey === confirmed.shadowDeviceKey && m.discovered.raw === confirmed.discoveredRaw);
          if (!child) continue;
          await tx.device.update({ where: { deviceKey: child.shadowDeviceKey }, data: { realUuid: child.discovered.raw, registrationState: 'REGISTERED', simulationDesired: false, portBindings: child.proposedPortBindings, deviceTypeId: child.resolvedDeviceTypeId } });
        }

        for (const extra of input.decisions.acceptExtras) {
          if (!extra.placeOnCanvas) continue;
          const nodeId = `auto-${extra.discoveredRaw}`;
          await tx.device.create({ data: { siteGroupId: gw.siteGroupId, canvasNodeId: nodeId, deviceTypeId: extra.deviceTypeId, parentDeviceKey: gw.deviceKey, shadowUuid: extra.discoveredRaw, realUuid: extra.discoveredRaw, registrationState: 'REGISTERED', simulationDesired: false } });
          await appendNodeToNodeConfig(tx, gw.siteGroupId, { id: nodeId, type: 'deviceNode', position: { x: 0, y: 0 }, data: { label: nodeId, deviceTypeId: extra.deviceTypeId }, parentCanvasNodeId: gw.canvasNodeId });
        }

        for (const rejected of input.decisions.rejectShadows) {
          if (rejected.action === 'soft-archive') await tx.device.update({ where: { deviceKey: rejected.shadowDeviceKey }, data: { registrationState: 'ORPHANED' } });
          if (rejected.action === 'keep-simulated') await tx.device.update({ where: { deviceKey: rejected.shadowDeviceKey }, data: { registrationState: 'UNREGISTERED' } });
          if (rejected.action === 'keep-as-manual') await tx.device.update({ where: { deviceKey: rejected.shadowDeviceKey }, data: { config: { manual: true } } });
        }

        await tx.registrationProposal.update({ where: { id: proposal.id }, data: { state: 'COMMITTED', userDecisionsJson: input.decisions, committedAt: new Date() } });
        recordRegistrationAudit(tx, { orgId: ctx.orgId!, userId: ctx.userId, action: 'gateway.register-success', targetId: gw.deviceKey, metadata: { gatewayDeviceKey: gw.deviceKey, registrationSessionId: proposal.id } });
      });

      return { ok: true, gatewayDeviceKey: gw.deviceKey };
    }),

  abortRegistration: orgProcedure
    .input(z.object({ orgId: z.string().cuid(), registrationSessionId: z.string().cuid(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.$transaction(async (tx) => {
        const proposal = await tx.registrationProposal.findUnique({ where: { id: input.registrationSessionId } });
        if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
        await tx.device.updateMany({ where: { OR: [{ deviceKey: proposal.gatewayDeviceKey }, { parentDeviceKey: proposal.gatewayDeviceKey }], registrationState: 'REGISTERING' }, data: { registrationState: 'UNREGISTERED' } });
        await tx.registrationProposal.update({ where: { id: proposal.id }, data: { state: 'ABORTED', abortedAt: new Date(), userDecisionsJson: { reason: input.reason ?? '' } } });
        recordRegistrationAudit(tx, { orgId: ctx.orgId!, userId: ctx.userId, action: 'gateway.register-aborted', targetId: proposal.gatewayDeviceKey, metadata: { gatewayDeviceKey: proposal.gatewayDeviceKey, registrationSessionId: proposal.id, reason: input.reason ?? null } });
      });
      return { ok: true };
    }),

  listStuckRegistrations: orgProcedure
    .input(z.object({ orgId: z.string().cuid(), siteGroupId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.registrationProposal.findMany({ where: { state: 'PROPOSED', expiresAt: { gt: new Date() }, gateway: { siteGroupId: input.siteGroupId } }, orderBy: { createdAt: 'desc' } });
    }),
});

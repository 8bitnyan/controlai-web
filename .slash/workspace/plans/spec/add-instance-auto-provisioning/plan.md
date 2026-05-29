---
name: "Auto-provision ControlAI daemon instances on demand"
overview: "Implement the OpenSpec change add-instance-auto-provisioning: schema migration adding env/provisioningStartedAt/provisionerInstanceId columns + PROVISIONING/PROVISION_FAILED enum values + partial unique index; pluggable InstanceProvisioner interface (mock + Fly.io); three new tRPC procedures (provision, retryProvision, deprovision) with async return-and-poll flow; background provisionTask with audit + encrypted bearer-token handling; 24h stuck-row cleanup cron wired via instrumentation.ts; Provision Instance dialog UI side-by-side with existing register flow; full docs + monorepo verification. BYO path (instance.register) must remain bit-for-bit unchanged; all new state is additive and nullable."
created: "2026-05-28T00:00:00Z"
last_updated: "2026-05-28T11:15:00Z"
isProject: false
type: "spec"
change_id: "add-instance-auto-provisioning"
plan_status: "done"
trigger: "Slash-apply openspec/changes/add-instance-auto-provisioning/ — mad-agent invoked planner to produce executable implementation plan mirroring tasks.md (sections 1–9) with parallelization batches, file allowlists per coder slice, TDD ordering, pnpm workspace commands, and the final openspec validate --strict gate."
todos:
  # Section 1 — Schema & migration
  - id: schema-edit-prisma
    content: "Add env, provisioningStartedAt, provisionerInstanceId columns + PROVISIONING/PROVISION_FAILED enum values to schema.prisma (documented; partial unique enforced via raw SQL migration)."
    status: done
  - id: schema-write-migration-sql
    content: "Hand-write migration.sql adding enum values, 3 columns, and partial unique index WHERE env IS NOT NULL."
    status: done
  - id: schema-prisma-generate
    content: "Run prisma generate in @controlai-web/db and commit generated client diff."
    status: done
  - id: schema-migrate-deploy
    content: "Apply migration locally via prisma migrate deploy; confirm schema matches expected DDL."
    status: done
  # Section 2 — Shared validation schemas
  - id: validation-provision-schema
    content: "Add ProvisionInstanceSchema ({ orgId, name 1–128, env enum }) to packages/shared-types/src/validation.ts."
    status: done
  - id: validation-retry-schema
    content: "Add RetryProvisionSchema ({ orgId, instanceId }) to packages/shared-types/src/validation.ts."
    status: done
  - id: validation-deprovision-schema
    content: "Add DeprovisionInstanceSchema ({ orgId, instanceId }) to packages/shared-types/src/validation.ts."
    status: done
  - id: validation-exports
    content: "Export the three new schemas from packages/shared-types/src/index.ts (re-export barrel)."
    status: done
  # Section 3 — Slug + URL derivation helpers
  - id: slug-helper-test
    content: "Write packages/api/src/lib/__tests__/org-slug.test.ts covering deriveSubdomain happy path, invalid-slug rejection, env enum enforcement (TDD: test first)."
    status: done
  - id: slug-helper-impl
    content: "Create packages/api/src/lib/org-slug.ts exporting deriveSubdomain(slug, env), InvalidSlugError, and the slug shape regex /^[a-z][a-z0-9-]{1,63}$/."
    status: done
  # Section 4 — Provisioner interface + mock + fly impl
  - id: provisioner-tests
    content: "Write packages/api/src/lib/__tests__/instance-provisioner.test.ts covering mock happy path, getProvisioner factory selection, fly impl with fetch mocked (success, machine-start timeout, cert-add failure, deprovision) — TDD: tests first."
    status: done
  - id: provisioner-interface
    content: "Create packages/api/src/lib/instance-provisioner.ts exporting InstanceProvisioner interface, ProvisionerError class, getProvisioner() factory keyed on INSTANCE_PROVISIONER."
    status: done
  - id: provisioner-mock-impl
    content: "Implement MockProvisioner returning deterministic synthetic bearer + provisionerInstanceId='mock-${cuid()}'; selected by default when env var unset or NODE_ENV=test."
    status: done
  - id: provisioner-fly-impl
    content: "Implement FlyProvisioner against api.machines.dev: idempotent app-create, machine-create, cert-add, poll-until-started (45s budget), reads FLY_API_TOKEN/ORG_SLUG/APP_NAME_PREFIX/REGION + DAEMON_BASE_DOMAIN + DAEMON_IMAGE."
    status: done
  - id: provisioner-fly-deprovision
    content: "Implement FlyProvisioner.deprovision(): DELETE machine + DELETE cert + DELETE app-if-empty (best-effort 404 tolerant)."
    status: done
  - id: provisioner-factory-failfast
    content: "Factory throws at module-load when INSTANCE_PROVISIONER=fly and FLY_API_TOKEN/FLY_ORG_SLUG missing."
    status: done
  # Section 5 — tRPC procedures
  - id: trpc-router-tests
    content: "Write/extend packages/api/src/routers/__tests__/instance.test.ts (mirror device.test.ts harness) covering 7 scenarios: provision happy → HEALTHY; (orgId,env) collision → 409; provisioner throw → PROVISION_FAILED + audit; retryProvision flips failed → provisioning; deprovision blocked by projects; deprovision OK zero projects; non-admin → FORBIDDEN. TDD: tests first."
    status: done
  - id: trpc-provision-procedure
    content: "Add instance.provision (ownerAdminProcedure) to packages/api/src/routers/instance.ts: org-slug shape check, (orgId,env) uniqueness check, INSERT PROVISIONING row with encrypted PLACEHOLDER, return { id }, fire void provisionTask(...)."
    status: done
  - id: trpc-provision-task
    content: "Create packages/api/src/lib/provision-task.ts exporting provisionTask(prisma, instanceId, args) — calls provisioner, on success UPDATE row HEALTHY + real encrypted token + provisionerInstanceId + checkDaemonHealth sanity, writes audit; on failure UPDATE PROVISION_FAILED + audit. Never throws."
    status: done
  - id: trpc-retry-procedure
    content: "Add instance.retryProvision (ownerAdminProcedure): assert status IN (PROVISIONING, PROVISION_FAILED) AND env IS NOT NULL, flip to PROVISIONING, reset provisioningStartedAt, fire provisionTask. Idempotent."
    status: done
  - id: trpc-deprovision-procedure
    content: "Add instance.deprovision (ownerAdminProcedure): load instance + projects(name), OWNER role check, refuse if projects.length > 0 with names list, call provisioner.deprovision if provisionerInstanceId set, delete row, write audit."
    status: done
  # Section 6 — Stuck-row cleanup job
  - id: cleanup-tests
    content: "Write apps/web/lib/cron/__tests__/cleanup-failed-provisions.test.ts: only deletes rows >24h old, skips if status changed mid-flight (transactional re-read), calls deprovision when provisionerInstanceId set, swallows provisioner errors and still deletes. TDD: tests first."
    status: done
  - id: cleanup-impl
    content: "Create apps/web/lib/cron/cleanup-failed-provisions.ts exporting runCleanupTick(prisma): tx{find PROVISION_FAILED + updatedAt<NOW-24h, re-read in tx, call provisioner.deprovision best-effort, delete row, audit instance.autoCleanup}."
    status: done
  - id: cleanup-instrumentation
    content: "Create apps/web/instrumentation.ts wiring setInterval(runCleanupTick, 3600_000) on Node runtime with a globalThis symbol single-shot guard so dev/HMR doesn't double-schedule."
    status: done
  # Section 7 — Web UI
  - id: ui-provision-dialog
    content: "Create apps/web/components/instances/provision-instance-dialog.tsx: form (name, env radio), live URL preview reading org slug + NEXT_PUBLIC_DAEMON_BASE_DOMAIN, calls trpc.instance.provision.useMutation, polls trpc.instance.get every 2s up to 60s, renders retry/deprovision on PROVISION_FAILED."
    status: done
  - id: ui-instances-page-wire
    content: "Edit apps/web/app/(app)/orgs/[orgId]/instances/page.tsx to add a 'Provision new daemon' CTA (opens new dialog) alongside the existing 'Register Instance' link; preserve current list rendering."
    status: done
  - id: ui-status-pills
    content: "Extend the STATUS_CONFIG in instances/page.tsx with PROVISIONING (animated/warning) and PROVISION_FAILED (destructive + retry link)."
    status: done
  - id: ui-deprovision-action
    content: "Wire deprovision action in the instance card (visible only when orgRole === OWNER && instance.env !== null); confirm dialog warns about Fly teardown."
    status: done
   # Section 8 — Docs
   - id: docs-provisioning
     content: "Write docs/instance-provisioning.md: prerequisites (wildcard DNS, Fly cert, env vars), flow diagram, retry semantics, troubleshooting matrix."
     status: done
   - id: docs-byo-vs-managed
     content: "Write docs/instance-byo-vs-managed.md: side-by-side table register vs provision, slug immutability note, target audiences."
     status: done
   - id: docs-readme-update
     content: "Add cross-links to the two new docs in apps/web/README.md (or root README) under an Instances section."
     status: done
  # Section 9 — Verification
  - id: verify-api-typecheck
    content: "pnpm --filter @controlai-web/api typecheck — green."
    status: pending
  - id: verify-api-tests
    content: "pnpm --filter @controlai-web/api test — green; coverage hits 7 router scenarios + cleanup tick + slug helper."
    status: pending
  - id: verify-web-typecheck
    content: "pnpm --filter @controlai-web/web typecheck — green."
    status: pending
  - id: verify-monorepo
    content: "pnpm -r typecheck && pnpm -r test — green across monorepo."
    status: pending
  - id: verify-openspec
    content: "pnpm openspec validate add-instance-auto-provisioning --strict — green."
    status: pending
  - id: verify-smoke
    content: "Manual click-through with INSTANCE_PROVISIONER=mock: provision → HEALTHY, retry path, deprovision, collision 409."
    status: pending
---

# Plan: Auto-provision ControlAI daemon instances on demand

## Background & Research

### OpenSpec inputs (read-only)
- `openspec/changes/add-instance-auto-provisioning/proposal.md` — Why/What/Impact (35 lines).
- `openspec/changes/add-instance-auto-provisioning/design.md` — 217 lines; the canonical source for: URL derivation, partial unique index DDL, async-return-immediately flow, provisioner interface contract, Fly.io API shape, state machine, audit actions, migration strategy, risks.
- `openspec/changes/add-instance-auto-provisioning/tasks.md` — 63-line checklist this plan mirrors verbatim.
- `openspec/changes/add-instance-auto-provisioning/specs/instance-management/spec.md` — 154 lines, 7 ADDED requirements (provision, retry, deprovision, pluggable provisioner, auto-cleanup, BYO preserved, URL derivation).
- `openspec/changes/add-instance-auto-provisioning/specs/organization/spec.md` — 30 lines, 2 ADDED requirements (slug immutable, slug shape validation).
- `openspec/changes/add-instance-auto-provisioning/research-refs.md` — provider cost table + Fly.io endpoint catalog.

### External research already on disk
- `.slash/workspace/research/cost-daemon-provisioner-providers.md` — Fly.io vs Railway vs Render vs GKE cost & API comparison.
- `.slash/workspace/research/identity-rewrite-and-provisioning.md` — adjacent work, useful for terminology alignment.

### Verbatim code snippets from current codebase

#### `packages/db/prisma/schema.prisma` — `ControlaiInstance` (lines 138–159)
```prisma
model ControlaiInstance {
  id                String         @id @default(cuid())
  orgId             String
  name              String
  baseURL           String
  bearerTokenEnc    String // AES-256-GCM encrypted; plaintext never stored
  status            InstanceStatus @default(UNKNOWN)
  lastSeenAt        DateTime?
  version           String?
  capacityUsedMB    Int?
  capacityAllowedMB Int?
  consecutiveFails  Int            @default(0)
  addedById         String
  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt

  org      Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  addedBy  User         @relation(fields: [addedById], references: [id])
  projects Project[]

  @@index([orgId])
}
```

#### `packages/db/prisma/schema.prisma` — `Organization` (lines 75–89)
```prisma
model Organization {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  logo      String?
  metadata  String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  members     OrganizationMember[]
  invitations OrganizationInvitation[]
  instances   ControlaiInstance[]
  projects    Project[]
  auditLogs   AuditLog[]
}
```

#### `packages/db/prisma/schema.prisma` — `InstanceStatus` enum (lines 161–166)
```prisma
enum InstanceStatus {
  UNKNOWN
  HEALTHY
  DEGRADED
  UNREACHABLE
}
```
Target after migration: add `PROVISIONING`, `PROVISION_FAILED` (must use `ALTER TYPE ... ADD VALUE IF NOT EXISTS` raw SQL — Prisma can't atomically add enum values to PG enums in a single shadow-DB run).

#### `packages/db/prisma/schema.prisma` — `Project` (lines 170–184)
```prisma
model Project {
  id         String   @id @default(cuid())
  orgId      String
  instanceId String
  name       String
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  org        Organization      @relation(fields: [orgId], references: [id], onDelete: Cascade)
  instance   ControlaiInstance @relation(fields: [instanceId], references: [id])
  siteGroups SiteGroup[]

  @@index([orgId])
  @@index([instanceId])
}
```
`deprovision` MUST refuse when `projects.length > 0`, mirroring the existing `instance.delete` guard.

#### `packages/api/src/routers/instance.ts` — imports (lines 1–13)
```ts
import { TRPCError } from '@trpc/server';
import { router, orgProcedure, ownerAdminProcedure } from '../trpc';
import { writeAudit } from '../lib/audit-writer';
import { encryptToken, decryptToken } from '../lib/crypto';
import { checkDaemonHealth, DaemonError } from '../lib/daemon-client';
import { z } from 'zod';
import {
  ListInstancesSchema,
  RegisterInstanceSchema,
  UpdateInstanceSchema,
  DeleteInstanceSchema,
  TestConnectionSchema,
} from '@controlai-web/shared-types';
```

#### `packages/api/src/routers/instance.ts` — `register` procedure (lines 67–112)
```ts
register: ownerAdminProcedure
  .input(RegisterInstanceSchema)
  .mutation(async ({ ctx, input }) => {
    let health;
    try {
      health = await checkDaemonHealth(input.baseURL, input.bearerToken);
    } catch (err) {
      if (err instanceof DaemonError && err.statusCode === 401) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Bearer token rejected by daemon (401)` });
      }
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Cannot reach daemon at ${input.baseURL}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    const instance = await ctx.prisma.controlaiInstance.create({
      data: {
        orgId: input.orgId,
        name: input.name,
        baseURL: input.baseURL,
        bearerTokenEnc: encryptToken(input.bearerToken),
        status: 'HEALTHY',
        lastSeenAt: new Date(),
        version: health.version ?? null,
        capacityUsedMB: health.capacity?.used_mb ?? null,
        capacityAllowedMB: health.capacity?.allowed_mb ?? null,
        addedById: ctx.userId!,
      },
    });

    void writeAudit(ctx.prisma, {
      orgId: input.orgId,
      userId: ctx.userId,
      action: 'instance.register',
      targetId: instance.id,
      targetType: 'ControlaiInstance',
      metadata: { name: input.name, baseURL: input.baseURL },
    });

    return instance;
  }),
```
**MUST stay byte-for-byte unchanged per spec requirement "BYO registration path is preserved".**

#### `packages/api/src/routers/instance.ts` — `delete` procedure (lines 197–240) — pattern to mirror for deprovision
```ts
delete: ownerAdminProcedure
  .input(DeleteInstanceSchema)
  .mutation(async ({ ctx, input }) => {
    const instance = await ctx.prisma.controlaiInstance.findFirst({
      where: { id: input.instanceId, orgId: ctx.orgId! },
      include: { projects: { select: { name: true } } },
    });
    if (!instance) throw new TRPCError({ code: 'NOT_FOUND' });

    const member = await ctx.prisma.organizationMember.findUnique({
      where: { orgId_userId: { orgId: instance.orgId, userId: ctx.userId! } },
    });
    if (member?.role !== 'OWNER') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the org OWNER can delete an instance' });
    }

    if (instance.projects.length > 0) {
      const names = instance.projects.map((p) => p.name).join(', ');
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Cannot delete instance: the following projects depend on it — ${names}`,
      });
    }

    await ctx.prisma.controlaiInstance.delete({ where: { id: input.instanceId } });

    void writeAudit(ctx.prisma, {
      orgId: instance.orgId,
      userId: ctx.userId,
      action: 'instance.delete',
      targetId: instance.id,
      targetType: 'ControlaiInstance',
    });

    return { success: true };
  }),
```

#### `packages/api/src/routers/instance.ts` — `get` (lines 19–38) — UI polls this until HEALTHY/PROVISION_FAILED
```ts
get: orgProcedure
  .input(z.object({ orgId: z.string().cuid(), instanceId: z.string().cuid() }))
  .query(async ({ ctx, input }) => {
    const instance = await ctx.prisma.controlaiInstance.findFirst({
      where: { id: input.instanceId, orgId: ctx.orgId! },
      select: {
        id: true, name: true, baseURL: true, status: true,
        lastSeenAt: true, version: true,
        capacityUsedMB: true, capacityAllowedMB: true,
        createdAt: true,
      },
    });
    if (!instance) throw new TRPCError({ code: 'NOT_FOUND' });
    return instance;
  }),
```
**Coder must extend the `select:` to also return `env`, `provisioningStartedAt`, and the new statuses so the polling UI can render them. This is a safe additive change.**

#### `packages/api/src/lib/crypto.ts` — `encryptToken` (lines 41–60)
```ts
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), encrypted.toString('base64'), authTag.toString('base64')].join(':');
}
```
Provision flow encrypts the placeholder at INSERT time and the real Fly-returned token after the provisioner resolves. Plaintext **never** persists.

#### `packages/api/src/lib/audit-writer.ts` — signature (lines 7–34)
```ts
export interface WriteAuditInput {
  orgId: string;
  userId?: string | null;
  action: string;
  targetId?: string | null;
  targetType?: string | null;
  metadata?: Record<string, unknown> | null;
}
export async function writeAudit(db: PrismaClient, input: WriteAuditInput): Promise<void> { /* fire-and-forget */ }
```
Audit actions used by this spec: `instance.provision`, `instance.provisionFailed`, `instance.retryProvision`, `instance.deprovision`, `instance.autoCleanup`.

#### `packages/api/src/lib/daemon-client.ts` — `checkDaemonHealth` (lines 76–101) — sanity-check after Fly returns
```ts
export async function checkDaemonHealth(baseURL: string, bearerToken: string): Promise<DaemonHealthResponse> {
  const url = `${baseURL.replace(/\/$/, '')}/v1/health`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS); // 10s
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Authorization: `Bearer ${bearerToken}` } });
    if (!response.ok) throw new DaemonError(response.status, await response.text().catch(() => ''), url);
    return (await response.json()) as DaemonHealthResponse;
  } finally { clearTimeout(timeoutId); }
}
```

#### `packages/shared-types/src/validation.ts` — existing `RegisterInstanceSchema` (lines 125–130) and slug regex (lines 5–12)
```ts
export const RegisterInstanceSchema = z.object({
  orgId: z.string().cuid(),
  name: z.string().min(1).max(128),
  baseURL: z.string().url(),
  bearerToken: z.string().min(1),
});

export const CreateOrgSchema = z.object({
  name: z.string().min(2).max(64),
  slug: z.string().min(2).max(48)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
});
```
**Note**: the CreateOrgSchema regex is looser than the design.md regex `/^[a-z][a-z0-9-]{1,63}$/`. The new `org-slug.ts` helper MUST use the stricter design regex defensively; do NOT loosen CreateOrgSchema in this change.

#### `packages/api/src/routers/__tests__/device.test.ts` — vitest harness pattern to mirror
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appRouter } from '../../root';
import { writeAudit } from '../../lib/audit-writer';

vi.mock('../../lib/audit-writer', () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));

function makePrisma() {
  return {
    organizationMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
    controlaiInstance: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    organization: { findUnique: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
}

function makeCaller(prisma: ReturnType<typeof makePrisma>) {
  const now = new Date();
  const ctx = {
    prisma,
    session: { session: { id: 's1', createdAt: now, updatedAt: now, userId: 'u1', expiresAt: now, token: 't1' },
              user: { id: 'u1', createdAt: now, updatedAt: now, email: 'u1@example.com', emailVerified: true, name: 'u1' } },
    userId: 'u1', orgId: ORG_ID, orgRole: 'OWNER',
    req: new Request('http://localhost'),
  } as unknown as Parameters<typeof appRouter.createCaller>[0];
  return appRouter.createCaller(ctx);
}
```

#### `apps/web/app/(app)/orgs/[orgId]/instances/page.tsx` — current list page (excerpt)
```tsx
const { data: instances, isLoading } = trpc.instance.list.useQuery({ orgId });
const utils = trpc.useUtils();
const deleteInstance = trpc.instance.delete.useMutation({
  onSuccess: () => void utils.instance.list.invalidate({ orgId }),
});

const STATUS_CONFIG = {
  HEALTHY: { variant: 'success' as const, icon: Wifi, label: 'Healthy' },
  DEGRADED: { variant: 'warning' as const, icon: Activity, label: 'Degraded' },
  UNREACHABLE: { variant: 'destructive' as const, icon: WifiOff, label: 'Unreachable' },
  UNKNOWN: { variant: 'secondary' as const, icon: Activity, label: 'Unknown' },
} as const;
```
**Coder MUST extend STATUS_CONFIG with `PROVISIONING` (warning + animated icon) and `PROVISION_FAILED` (destructive + retry link).**
**Important path correction**: spec proposal references `apps/web/app/[org]/instances/page.tsx`, but the **actual** path in the repo is `apps/web/app/(app)/orgs/[orgId]/instances/page.tsx`. Use the actual path.

#### `apps/web/app/(app)/orgs/[orgId]/instances/new/page.tsx` — current register page pattern (no dialog; inline form)
Plain `useState`-based form (no react-hook-form, no `form.tsx`/`radio-group.tsx` shadcn primitives — they do not exist in this repo). The new `provision-instance-dialog.tsx` SHOULD follow the same pattern: plain `useState` for `name` + `env`, manual radio rendering with `<input type="radio">` styled via Tailwind, and a derived URL `<p>` preview.

#### `apps/web/components/domain/delete-confirm-dialog.tsx` — Dialog usage template (lines 1–94)
```tsx
interface DeleteConfirmDialogProps {
  resourceName: string;
  resourceType?: string;
  onConfirm: () => Promise<unknown>;
  trigger?: React.ReactNode;
  disabled?: boolean;
}
// internals: Dialog + DialogContent + DialogHeader + DialogTitle + DialogDescription + DialogFooter,
// Loader2 spinner during pending, error banner with destructive/10 alert box.
```
**Pattern source for `provision-instance-dialog.tsx` AND for the deprovision confirm.**

#### `apps/web/components/ui/` available primitives
- `dialog.tsx` — exports `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`.
- `button.tsx` — variants `default | destructive | outline | secondary | ghost | link`, sizes `default | sm | lg | icon`.
- `input.tsx`, `label.tsx`, `card.tsx`, `badge.tsx` (variants include `success`/`warning`).
- **MISSING in repo**: `form.tsx`, `radio-group.tsx` — do NOT introduce them in this change; use plain HTML + Tailwind.

#### `packages/api/src/trpc.ts` — procedure exports (lines 45, 88, 134)
```ts
export const protectedProcedure = t.procedure.use(isAuthed);
export const orgProcedure = t.procedure.use(isOrgMember);
export const ownerAdminProcedure = t.procedure.use(isOwnerOrAdmin); // OWNER or ADMIN only
```
`isOwnerOrAdmin` already throws `FORBIDDEN` for `MEMBER` role — the procedure-level guard is enough for the "non-admin → FORBIDDEN" spec scenario; the additional in-body OWNER check is only needed for `deprovision`.

#### `packages/db/prisma/migrations/` — recent timestamps
```
20260525000000_add_gateway/
20260527123516_add_gateway_provisioning_tracking/
20260527140000_add_device_table_and_lifecycle/
20260528000000_add_registration_proposal/
20260528120000_add_site_driver_config/
```
**New migration folder**: `20260528120001_add_instance_provisioning/`.

#### Migration SQL (from design.md §Migration strategy) — exact DDL coder MUST write
```sql
-- packages/db/prisma/migrations/20260528120001_add_instance_provisioning/migration.sql
ALTER TYPE "InstanceStatus" ADD VALUE IF NOT EXISTS 'PROVISIONING';
ALTER TYPE "InstanceStatus" ADD VALUE IF NOT EXISTS 'PROVISION_FAILED';

ALTER TABLE "ControlaiInstance"
  ADD COLUMN "env" TEXT,
  ADD COLUMN "provisioningStartedAt" TIMESTAMP(3),
  ADD COLUMN "provisionerInstanceId" TEXT;

CREATE UNIQUE INDEX "ControlaiInstance_orgId_env_unique"
  ON "ControlaiInstance" ("orgId", "env")
  WHERE "env" IS NOT NULL;
```

#### `apps/web/.env.example` — current env keys
```
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=<32-byte-random>
BETTER_AUTH_URL=http://localhost:3000
INSTANCE_TOKEN_KEY=<64-char-hex-string>
CRON_SECRET=<random-cron-secret>
SIMULATOR_INTERNAL_URL=http://localhost:4001
SIMULATOR_PUBLIC_URL=http://localhost:4001
SIMULATOR_API_TOKEN=<random-secret>
```
**MUST ADD** to `apps/web/.env.example` (and root `.env.example` if present):
- `DAEMON_BASE_DOMAIN=daemons.controlai.io`
- `NEXT_PUBLIC_DAEMON_BASE_DOMAIN=daemons.controlai.io`
- `INSTANCE_PROVISIONER=mock` (values: `mock` | `fly`)
- `FLY_API_TOKEN=` (required only if INSTANCE_PROVISIONER=fly)
- `FLY_ORG_SLUG=`
- `FLY_APP_NAME_PREFIX=controlai-daemon`
- `FLY_REGION=iad`
- `DAEMON_IMAGE=ghcr.io/controlai/daemon:stable`

#### `apps/web/instrumentation.ts` — does NOT exist
Coder F creates it from scratch. Next.js auto-detects the file at project root of the app. Use the `register()` export pattern:
```ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const sym = Symbol.for('controlai.cleanup-failed-provisions.scheduled');
  if ((globalThis as any)[sym]) return;
  (globalThis as any)[sym] = true;
  const { runCleanupTick } = await import('./lib/cron/cleanup-failed-provisions');
  const { prisma } = await import('@controlai-web/db');
  setInterval(() => { void runCleanupTick(prisma).catch((e) => console.error('[cleanup-tick]', e)); }, 60 * 60 * 1000);
  void runCleanupTick(prisma).catch((e) => console.error('[cleanup-tick]', e)); // run once at boot
}
```

### Testing policy reminders
- **TDD ordering is mandatory per tasks.md §3.2, §4.6, §5.5, §6.3.** Each test todo in this plan is listed BEFORE its corresponding impl todo and MUST land first (red → green).
- Tests use vitest + mocked Prisma (no real DB) — mirror `device.test.ts` exactly.
- For provisioner tests, mock `globalThis.fetch` (or pass an injected fetcher) — do NOT make real Fly calls.
- For cleanup-tick tests, mock `Date` / pass a `now` argument to `runCleanupTick` so the >24h boundary is deterministic.

## Testing Plan

- [x] `slug-helper-test`: write `packages/api/src/lib/__tests__/org-slug.test.ts` — covers happy path (`acme` + `prod` → `acme-prod`), invalid slug shapes (`UPPERCASE`, `1leading`, `bad_underscore`, `too-long-…`), invalid env (`production` not in enum). Must fail with `InvalidSlugError` before impl exists.
- [ ] `provisioner-tests`: write `packages/api/src/lib/__tests__/instance-provisioner.test.ts` — MockProvisioner happy path, factory selection by env var (unset/mock → mock, fly → fly with creds, fly without creds → throws), FlyProvisioner.provision success (mocked fetch sequence: app POST → machine POST → cert POST → polls), machine-start timeout (polls exceed 45s budget → ProvisionerError), cert-add 422 surfaced, deprovision DELETE chain (machine + cert + app-if-empty), 404 tolerance on cleanup.
- [x] `trpc-router-tests`: write/extend `packages/api/src/routers/__tests__/instance.test.ts` — 7 scenarios:
  1. `provision` happy → row created PROVISIONING with placeholder token, returns `{ id }`; after awaiting `provisionTask` row is HEALTHY with real encrypted token + `instance.provision` audit.
  2. Collision: existing `(orgId, env)` row → CONFLICT, no insert.
  3. Provisioner throws → row PROVISION_FAILED + `instance.provisionFailed` audit with error metadata.
  4. `retryProvision` on PROVISION_FAILED row → row flips to PROVISIONING; on BYO row (env IS NULL) → BAD_REQUEST; on HEALTHY row → BAD_REQUEST.
  5. `deprovision` blocked when projects.length > 0 → BAD_REQUEST listing names.
  6. `deprovision` with zero projects + provisionerInstanceId set → provisioner.deprovision called, row deleted, audit written.
  7. Non-admin caller (`role: 'MEMBER'`) → FORBIDDEN at procedure middleware.
- [x] `cleanup-tests`: write `apps/web/lib/cron/__tests__/cleanup-failed-provisions.test.ts` — only deletes PROVISION_FAILED + updatedAt < NOW-24h; transaction re-read with status change → skip (row left intact); provisioner.deprovision called when provisionerInstanceId set; provisioner.deprovision rejection swallowed and row still deleted; recent failed row (<24h) untouched.

## Implementation Plan

> Mirrors `openspec/changes/add-instance-auto-provisioning/tasks.md` sections 1–9. Every `- [ ]` is keyed to a `todos[].id` in frontmatter.

### 1. Schema & migration
- [x] `schema-edit-prisma`: Edit `packages/db/prisma/schema.prisma` — add `env String?`, `provisioningStartedAt DateTime?`, `provisionerInstanceId String?` columns to `ControlaiInstance`; add `PROVISIONING` and `PROVISION_FAILED` to `InstanceStatus`. Inline comment explains the partial unique index lives in raw SQL (Prisma cannot express `WHERE env IS NOT NULL`).
- [x] `schema-write-migration-sql`: Hand-write `packages/db/prisma/migrations/20260528120001_add_instance_provisioning/migration.sql` (DDL exactly as shown in Background §Migration SQL).
- [x] `schema-prisma-generate`: `pnpm --filter @controlai-web/db prisma generate` and commit the resulting client diff.
- [x] `schema-migrate-deploy`: `pnpm --filter @controlai-web/db prisma migrate deploy` against the local Postgres; manual `psql \d "ControlaiInstance"` confirms the three new columns + the partial unique index exist.

### 2. Shared validation schemas
- [x] `validation-provision-schema`: Add `ProvisionInstanceSchema = z.object({ orgId: z.string().cuid(), name: z.string().min(1).max(128), env: z.enum(['prod','staging','dev']) })`.
- [x] `validation-retry-schema`: Add `RetryProvisionSchema = z.object({ orgId: z.string().cuid(), instanceId: z.string().cuid() })`.
- [x] `validation-deprovision-schema`: Add `DeprovisionInstanceSchema = z.object({ orgId: z.string().cuid(), instanceId: z.string().cuid() })`.
- [x] `validation-exports`: Re-export from `packages/shared-types/src/index.ts` so consumers `import { ProvisionInstanceSchema } from '@controlai-web/shared-types'`.

### 3. Slug + URL derivation helpers (TDD: §3.2 says test in 3.2 — test comes first)
- [x] `slug-helper-test`: Write the test file FIRST per tasks.md §3.2 ordering — see Testing Plan.
- [x] `slug-helper-impl`: Create `packages/api/src/lib/org-slug.ts`:
  - `SLUG_REGEX = /^[a-z][a-z0-9-]{1,63}$/`
  - `class InvalidSlugError extends Error`
  - `function deriveSubdomain(slug: string, env: 'prod'|'staging'|'dev'): string` — validates slug with regex (throw `InvalidSlugError` on mismatch) and returns `${slug}-${env}`.
  - Export both the regex and `InvalidSlugError` for consumer use.

### 4. Provisioner interface + mock + fly impl (TDD: §4.6 says test in 4.6 — test comes first)
- [x] `provisioner-tests`: Write the test file FIRST per tasks.md §4.6 — see Testing Plan.
- [x] `provisioner-interface`: Create `packages/api/src/lib/instance-provisioner.ts` with the exact interface from design.md §Provisioner contract (return shape `{ bearerToken, baseURL, ready, provisionerInstanceId }`), `class ProvisionerError extends Error { code: string; cause?: unknown }`, and `getProvisioner()` factory keyed on `process.env.INSTANCE_PROVISIONER`.
- [x] `provisioner-mock-impl`: Implement `MockProvisioner` returning deterministic outputs (use `crypto.randomBytes(32).toString('hex')` for token; `mock-${cuid()}` for provisioner id). Default selected when env var unset or in `NODE_ENV=test`.
- [x] `provisioner-fly-impl`: Implement `FlyProvisioner` per design.md §Fly.io implementation sketch:
  1. `POST https://api.machines.dev/v1/apps` with `{ app_name, org_slug }` — 200/409 both OK (idempotent).
  2. Generate fresh bearer token (`crypto.randomBytes(32).toString('hex')`).
  3. `POST /v1/apps/{app}/machines` with image=`DAEMON_IMAGE`, env=`{ DAEMON_BEARER_TOKEN: <token>, ... }`.
  4. `POST /v1/apps/{app}/certificates` with `hostname` = `${subdomain}.${DAEMON_BASE_DOMAIN}` (idempotent).
  5. Poll `GET /v1/apps/{app}/machines/{id}` until `state === 'started'`, 1s intervals, 45s budget; on timeout throw `ProvisionerError({ code: 'MACHINE_START_TIMEOUT' })`.
  6. Return `{ bearerToken, baseURL: 'https://'+subdomain+'.'+DAEMON_BASE_DOMAIN, ready: true, provisionerInstanceId: machineId }`.
- [x] `provisioner-fly-deprovision`: `FlyProvisioner.deprovision({ provisionerInstanceId, baseURL })`:
  - `DELETE /v1/apps/{app}/machines/{provisionerInstanceId}?force=true` (404 tolerated).
  - `DELETE /v1/apps/{app}/certificates/{hostname}` (404 tolerated).
  - Best-effort `DELETE /v1/apps/{app}` if the machines list is now empty.
- [x] `provisioner-factory-failfast`: In `getProvisioner()`, when `INSTANCE_PROVISIONER==='fly'` and any of `FLY_API_TOKEN`/`FLY_ORG_SLUG` is missing, throw a clear startup error.

### 5. tRPC procedures (TDD: §5.5 — tests first; mirror `instance.register`/`instance.delete` patterns)
- [x] `trpc-router-tests`: Write/extend `packages/api/src/routers/__tests__/instance.test.ts` FIRST — see Testing Plan for the 7 scenarios.
- [x] `trpc-provision-procedure`: Add `provision: ownerAdminProcedure.input(ProvisionInstanceSchema).mutation(async ({ ctx, input }) => { ... })`:
  - Load Organization by id; assert `slug` non-null+matches `SLUG_REGEX` (else `PRECONDITION_FAILED`).
  - Defensive findFirst on `controlaiInstance` `where: { orgId, env: input.env }` → throw CONFLICT with existing instance id if found (DB partial unique is belt-and-suspenders).
  - `const subdomain = deriveSubdomain(org.slug, input.env);`
  - `const baseURL = \`https://${subdomain}.${process.env.DAEMON_BASE_DOMAIN}\`;`
  - INSERT row: `status: 'PROVISIONING'`, `bearerTokenEnc: encryptToken('PLACEHOLDER')`, `provisioningStartedAt: new Date()`, `env: input.env`, `addedById: ctx.userId!`, `baseURL`.
  - Fire `void Promise.resolve().then(() => provisionTask(ctx.prisma, instance.id, { orgId, orgSlug: org.slug, subdomain, env: input.env, baseURL }))`.
  - Return `{ id: instance.id }`.
- [x] `trpc-provision-task`: Create `packages/api/src/lib/provision-task.ts`:
  - Calls `getProvisioner().provision({ orgId, orgSlug, subdomain, env })`.
  - On success: `checkDaemonHealth(baseURL, token)` 10s sanity. UPDATE row `status: 'HEALTHY'`, `bearerTokenEnc: encryptToken(token)`, `version`, `lastSeenAt: NOW()`, `provisionerInstanceId`. `void writeAudit({ action: 'instance.provision', metadata: { env, baseURL, provisionerBackend } })`.
  - On error (provisioner OR sanity-check failure): UPDATE row `status: 'PROVISION_FAILED'`. `void writeAudit({ action: 'instance.provisionFailed', metadata: { env, error: { code, message }, provisionerBackend } })`. Never re-throws.
- [x] `trpc-retry-procedure`: Add `retryProvision: ownerAdminProcedure.input(RetryProvisionSchema).mutation(async ({ ctx, input }) => { ... })`:
  - Load instance scoped to `ctx.orgId`. NOT_FOUND if missing.
  - Assert `status IN ('PROVISIONING','PROVISION_FAILED')` else BAD_REQUEST (covers HEALTHY/DEGRADED/UNREACHABLE explicit messages).
  - Assert `env IS NOT NULL` else BAD_REQUEST 'Cannot retry a BYO-registered instance'.
  - UPDATE `status: 'PROVISIONING'`, `provisioningStartedAt: NOW()`.
  - Fire `provisionTask` with reconstructed args (re-derive subdomain from org slug + env).
  - `void writeAudit({ action: 'instance.retryProvision', metadata: { previousStatus } })`.
  - Return `{ id: instance.id }`.
- [x] `trpc-deprovision-procedure`: Add `deprovision: ownerAdminProcedure.input(DeprovisionInstanceSchema).mutation(async ({ ctx, input }) => { ... })`:
  - Mirror `delete` procedure pattern verbatim for the load + OWNER role check + projects guard.
  - When `instance.provisionerInstanceId` is set, `await getProvisioner().deprovision({ provisionerInstanceId, baseURL: instance.baseURL })`; swallow errors? **NO** — per design.md these surface as TRPCError(`INTERNAL_SERVER_ERROR`) so the user knows the Fly side may need manual cleanup. (Cleanup cron is the lenient path; user-initiated deprovision should be strict.)
  - DELETE row.
  - `void writeAudit({ action: 'instance.deprovision', metadata: { provisionerBackend, projectsCheckedCount: 0 } })`.
  - Return `{ success: true }`.
- [x] (Coder must also extend `get` `select:` to include `env`, `provisioningStartedAt`, and surface the two new statuses — additive change documented in Background.)

### 6. Stuck-row cleanup job (TDD: §6.3 — tests first)
- [x] `cleanup-tests`: Write the test file FIRST per tasks.md §6.3.
- [x] `cleanup-impl`: Create `apps/web/lib/cron/cleanup-failed-provisions.ts`:
  - `export async function runCleanupTick(prisma: PrismaClient, now: Date = new Date()): Promise<{ scanned: number; deleted: number; skipped: number }>`.
  - `const cutoff = new Date(now.getTime() - 24*60*60*1000);`
  - `const candidates = await prisma.controlaiInstance.findMany({ where: { status: 'PROVISION_FAILED', updatedAt: { lt: cutoff } }, select: { id, orgId, baseURL, provisionerInstanceId } });`
  - For each candidate, run inside `prisma.$transaction(async (tx) => { const fresh = await tx.controlaiInstance.findUnique({ where: { id }, select: { status, provisionerInstanceId } }); if (!fresh || fresh.status !== 'PROVISION_FAILED') return 'skipped'; if (fresh.provisionerInstanceId) { try { await getProvisioner().deprovision({ provisionerInstanceId: fresh.provisionerInstanceId, baseURL }); } catch (e) { console.warn('[autoCleanup] deprovision swallowed', e); } } await tx.controlaiInstance.delete({ where: { id } }); return 'deleted'; })`.
  - Audit each delete with `instance.autoCleanup` action metadata `{ reason: 'failed-24h', deprovisionAttempted: boolean }`.
- [x] `cleanup-instrumentation`: Create `apps/web/instrumentation.ts` per the snippet in Background — Node-runtime-only, globalThis-symbol single-shot guard, hourly `setInterval`, kick-off run at boot.

### 7. Web UI
- [x] `ui-provision-dialog`: Create `apps/web/components/instances/provision-instance-dialog.tsx`:
  - Props: `{ orgId: string; orgSlug: string; daemonBaseDomain: string; existingEnvs: Array<'prod'|'staging'|'dev'>; onProvisioned?: (id: string) => void }`.
  - State: `name`, `env`, `polling`, `pollStart`, `error`.
  - Render the existing `<Dialog>` chrome (mirror `delete-confirm-dialog.tsx`).
  - Form fields: `<Input name>`, three `<input type="radio" name="env">` (disabled when `existingEnvs.includes(env)` — pre-empts the CONFLICT).
  - Live preview `<p>https://{orgSlug}-{env}.{daemonBaseDomain}</p>` updating on env change.
  - Submit handler: `trpc.instance.provision.useMutation()` → on success, start `setInterval(() => utils.instance.get.fetch({ orgId, instanceId }), 2000)` capped at 60s; close dialog when `status === 'HEALTHY'`; render error banner + Retry/Deprovision when `status === 'PROVISION_FAILED'`.
  - Reads `process.env.NEXT_PUBLIC_DAEMON_BASE_DOMAIN` for the preview when prop missing.
- [x] `ui-instances-page-wire`: Edit `apps/web/app/(app)/orgs/[orgId]/instances/page.tsx`:
  - Read org slug from a new `trpc.organization.get.useQuery({ orgId })` (if not already in context) OR pass via layout/params.
  - Replace single "Register Instance" `<Button asChild>` with two side-by-side CTAs: "Provision new daemon" (opens `ProvisionInstanceDialog`) + "Register existing daemon" (unchanged Link to `/orgs/[orgId]/instances/new`).
  - Compute `existingEnvs` from `instances.filter(i => i.env !== null).map(i => i.env)` and pass to dialog.
- [x] `ui-status-pills`: Extend `STATUS_CONFIG` in `instances/page.tsx`:
  - `PROVISIONING: { variant: 'warning', icon: Loader2 (animate-spin), label: 'Provisioning' }`.
  - `PROVISION_FAILED: { variant: 'destructive', icon: AlertTriangle, label: 'Failed' }`.
  - On `PROVISION_FAILED` cards, render an inline "Retry" button calling `trpc.instance.retryProvision.useMutation()`.
- [x] `ui-deprovision-action`: In the instance card actions area, when `orgRole === 'OWNER' && inst.env !== null`, render a "Deprovision" button that opens a `DeleteConfirmDialog` (resourceType=`'managed daemon'`) wired to `trpc.instance.deprovision.useMutation()`; copy warns about Fly teardown.

### 8. Docs
- [x] `docs-provisioning`: Write `docs/instance-provisioning.md` covering: prerequisites (wildcard DNS `*.daemons.controlai.io` A/AAAA → Fly anycast, one-time `fly certs add '*.daemons.controlai.io'`), required env vars (full table — DAEMON_BASE_DOMAIN, INSTANCE_PROVISIONER, FLY_*, DAEMON_IMAGE), end-to-end provision flow (mermaid copy from design.md), retry semantics, troubleshooting matrix (provisioner timeout, cert pending, machine OOM, audit log lookups).
- [x] `docs-byo-vs-managed`: Write `docs/instance-byo-vs-managed.md` with side-by-side table (instance.register vs instance.provision) covering: who initiates, who owns the daemon host, token handling, slug requirement, retry/deprovision availability, target audiences (on-prem/air-gapped vs managed-tier).
- [x] `docs-readme-update`: Add an "Instances" section to `apps/web/README.md` cross-linking both new docs.

### 9. Verification
- [ ] `verify-api-typecheck`: `pnpm --filter @controlai-web/api typecheck` clean.
- [ ] `verify-api-tests`: `pnpm --filter @controlai-web/api test` — all new tests pass; coverage hits the 7 router scenarios + cleanup tick + slug helper.
- [ ] `verify-web-typecheck`: `pnpm --filter @controlai-web/web typecheck` clean.
- [ ] `verify-monorepo`: `pnpm -r typecheck && pnpm -r test` green across monorepo.
- [ ] `verify-openspec`: `pnpm openspec validate add-instance-auto-provisioning --strict` green.
- [ ] `verify-smoke`: Manual smoke with `INSTANCE_PROVISIONER=mock`: end-to-end click-through provisions a fake daemon → row lands HEALTHY; retry path works on simulated failure; deprovision tears down; collision returns 409.

## Delegation Notes

### Parallelization Plan

```
Batch 0 (sequential, blocks everything else):
  └── Coder A — Schema migration

Batch 1 (parallel, after Batch 0 lands):
  ├── Coder B — Slug helper (TDD)
  ├── Coder C — Validation schemas
  ├── Coder D — Provisioner module (TDD)
  └── Coder E — Docs (no code dependency)

Batch 2 (sequential, after Batch 1 lands):
  └── Coder F — tRPC procedures + provisionTask + router tests (TDD)
       (depends on schema, validation, slug helper, provisioner)

Batch 3 (parallel, after Batch 2 lands):
  ├── Coder G — Cleanup cron + instrumentation (TDD)
  │            (depends on provisioner + schema; technically could parallel
  │             Batch 2 but provisionTask reference makes ordering simpler)
  └── Coder H — Web UI dialog + page wiring + status pills + deprovision UI
                (depends on tRPC procedures landing in Batch 2)

Batch 4 (sequential, LAST — by mad-agent / coordinator):
  └── Verification (typecheck + tests + openspec --strict + smoke)
```

### Batch 0 — Schema migration

- [ ] **Coder A** — todos: `schema-edit-prisma`, `schema-write-migration-sql`, `schema-prisma-generate`, `schema-migrate-deploy`
  - **Files (allowlist, exclusive)**:
    - `packages/db/prisma/schema.prisma` (edit)
    - `packages/db/prisma/migrations/20260528120001_add_instance_provisioning/migration.sql` (create)
    - `packages/db/src/generated/**` (regenerated, committed)

### Batch 1 — Parallel (4 coders, no file overlap)

- [ ] **Coder B** — todos: `slug-helper-test`, `slug-helper-impl`
  - **Files (allowlist, exclusive)**:
    - `packages/api/src/lib/__tests__/org-slug.test.ts` (create)
    - `packages/api/src/lib/org-slug.ts` (create)
- [x] **Coder C** — todos: `validation-provision-schema`, `validation-retry-schema`, `validation-deprovision-schema`, `validation-exports`
  - **Files (allowlist, exclusive)**:
    - `packages/shared-types/src/validation.ts` (edit — append new schemas only)
    - `packages/shared-types/src/index.ts` (edit — add re-exports only)
- [x] **Coder D** — todos: `provisioner-tests`, `provisioner-interface`, `provisioner-mock-impl`, `provisioner-fly-impl`, `provisioner-fly-deprovision`, `provisioner-factory-failfast`
  - **Files (allowlist, exclusive)**:
    - `packages/api/src/lib/__tests__/instance-provisioner.test.ts` (create)
    - `packages/api/src/lib/instance-provisioner.ts` (create)
- [ ] **Coder E** — todos: `docs-provisioning`, `docs-byo-vs-managed`, `docs-readme-update`
  - **Files (allowlist, exclusive)**:
    - `docs/instance-provisioning.md` (create)
    - `docs/instance-byo-vs-managed.md` (create)
    - `apps/web/README.md` (edit — add Instances section only)
    - Optionally: root `README.md` (edit — single cross-link)

### Batch 2 — Sequential (one coder, single file conflict zone)

- [x] **Coder F** — todos: `trpc-router-tests`, `trpc-provision-procedure`, `trpc-provision-task`, `trpc-retry-procedure`, `trpc-deprovision-procedure`
  - **Files (allowlist, exclusive)**:
    - `packages/api/src/routers/__tests__/instance.test.ts` (create OR edit — file may not exist; mirror `device.test.ts`)
    - `packages/api/src/routers/instance.ts` (edit — append 3 new procedures + extend `get` `select:`; DO NOT touch `register` body)
    - `packages/api/src/lib/provision-task.ts` (create)
    - `apps/web/.env.example` (edit — append new env vars)

### Batch 3 — Parallel (2 coders, no file overlap)

- [x] **Coder G** — todos: `cleanup-tests`, `cleanup-impl`, `cleanup-instrumentation`
  - **Files (allowlist, exclusive)**:
    - `apps/web/lib/cron/__tests__/cleanup-failed-provisions.test.ts` (create)
    - `apps/web/lib/cron/cleanup-failed-provisions.ts` (create)
    - `apps/web/instrumentation.ts` (create)
- [x] **Coder H** — todos: `ui-provision-dialog`, `ui-instances-page-wire`, `ui-status-pills`, `ui-deprovision-action`
  - **Files (allowlist, exclusive)**:
    - `apps/web/components/instances/provision-instance-dialog.tsx` (create)
    - `apps/web/app/(app)/orgs/[orgId]/instances/page.tsx` (edit — extend STATUS_CONFIG + wire new dialog + deprovision action; do NOT touch the existing `instance.list` query or the `Register Instance` link)

### Batch 4 — Verification (mad-agent / coordinator)

- [ ] All `verify-*` todos: `verify-api-typecheck`, `verify-api-tests`, `verify-web-typecheck`, `verify-monorepo`, `verify-openspec`, `verify-smoke`.

### Dependencies (why this batching exists)

- Schema migration must land first because every other slice imports the Prisma client type definitions for `env`, `provisioningStartedAt`, `provisionerInstanceId`, and the new enum values.
- Slug helper, validation schemas, and provisioner module are pure modules with no inter-dependency — perfect for Batch 1 parallelism.
- Docs depend only on the spec being final; the spec is final, so docs ride along Batch 1.
- tRPC procedures import slug helper + validation schemas + provisioner interface, so they must wait for Batch 1.
- Web UI imports tRPC procedure types (`trpc.instance.provision`, etc.) via `AppRouter`, so it must wait for Batch 2.
- Cleanup cron imports provisioner + Prisma; technically could parallel Batch 2 but we keep it in Batch 3 because:
  1. its test mocks share fixtures with the router tests, and
  2. coder G can also confirm the cleanup-tick interacts cleanly with `provisionTask` ordering.

### Risk Areas

- **Single-file contention**: `packages/api/src/routers/instance.ts` is touched only by Coder F. `packages/shared-types/src/validation.ts` is touched only by Coder C. No coder shares a file with another in the same batch.
- **Type generation race**: After Batch 0, every coder in Batch 1 must `pnpm install && pnpm --filter @controlai-web/db prisma generate` before starting so their TypeScript sees the new columns. Coder A commits the generated client so this should be a no-op clone, but document it in PR description.
- **Background task in tests**: `instance.provision` fires `void Promise.resolve().then(...)`. Router test must `await` the microtask drain (`await new Promise(r => setImmediate(r))` or pass a synchronous test override) before asserting the row reached HEALTHY/PROVISION_FAILED. Document the harness helper in `instance.test.ts`.
- **`get` `select:` extension**: Coder F MUST extend the existing `get` procedure's `select:` to include `env` + `provisioningStartedAt` + the two new statuses. Failure to do so will silently break the UI poll path in Batch 3 (status will appear undefined). Call this out explicitly in Coder F's prompt under CONSTRAINTS.
- **Slug regex tightening**: The new `org-slug.ts` regex `/^[a-z][a-z0-9-]{1,63}$/` is stricter than the existing `CreateOrgSchema` regex. Coder F's defensive check in `instance.provision` MUST use the stricter regex; do NOT change `CreateOrgSchema` in this spec (that's a separate change to enforce the stricter shape across all org creations).
- **`encryptToken('PLACEHOLDER')` semantics**: The placeholder value is meaningless and never read; it exists solely to satisfy the `bearerTokenEnc String` NOT-NULL constraint until the real token is written. Decoder MUST be tolerant — never attempt `decryptToken` on a PROVISIONING row.

## 8-Section Delegation Contract Template

> Copy this template per coder slice when mad-agent spawns the subagent. Replace `{...}` placeholders with the per-slice values from "Delegation Notes" above.

```
CONTEXT
- OpenSpec change: add-instance-auto-provisioning (spec docs at openspec/changes/add-instance-auto-provisioning/).
- Plan: .slash/workspace/plans/spec/add-instance-auto-provisioning/plan.md (this file). Read Background & Research before editing.
- Batch: {0|1|2|3|4}. Predecessor batches MUST be merged before you start.
- TDD policy: tasks.md sections 3.2, 4.6, 5.5, 6.3 require tests first. This applies to your slice if it covers any of those sections.

OBJECTIVE
- Land todos: {comma-separated todos[].id list for this coder}.
- Tasks.md section coverage: {1|2|3|4|5|6|7|8|9 subset}.

FILES (allowlist — you MUST NOT edit anything outside this list)
- {file list from Delegation Notes batch entry}

CONSTRAINTS
- pnpm workspaces: run package-scoped commands as `pnpm --filter <pkg> <cmd>`.
  - DB: `pnpm --filter @controlai-web/db prisma generate | migrate deploy`.
  - API: `pnpm --filter @controlai-web/api typecheck | test`.
  - Web: `pnpm --filter @controlai-web/web typecheck`.
- The BYO path `instance.register` is bit-for-bit immutable. Do not touch its body, its tests, or `RegisterInstanceSchema`.
- Plaintext bearer tokens MUST be wrapped in `encryptToken()` before any DB write or log call. Never serialize a plaintext token into audit metadata.
- Vitest + mocked Prisma only — no real DB in tests. Mirror `packages/api/src/routers/__tests__/device.test.ts`.
- Use only existing shadcn primitives: `Dialog`, `Button`, `Input`, `Label`, `Badge`, `Card`. Do NOT introduce `form.tsx` or `radio-group.tsx`.

TESTS (the only acceptable definition of done)
- {todo-ids of tests this coder writes/needs to keep green}.
- Run: `pnpm --filter <pkg> test --run {scoped path}`.
- Per-batch verification gate before handoff:
  - Batch 1: package-scoped `pnpm --filter @controlai-web/{api|shared-types} typecheck`.
  - Batch 2: `pnpm --filter @controlai-web/api typecheck && pnpm --filter @controlai-web/api test`.
  - Batch 3: `pnpm --filter @controlai-web/web typecheck`.

EVIDENCE (paste in PR / handoff message)
- Commit hash(es) of your batch.
- `pnpm --filter <pkg> test` output (last lines).
- `pnpm --filter <pkg> typecheck` exit-zero confirmation.
- For UI slices: 1–2 screenshots / a short loom of the click-through.

OUT-OF-SCOPE (HARD STOPS)
- Editing files outside the allowlist.
- Modifying `instance.register` body, `RegisterInstanceSchema`, or `CreateOrgSchema`.
- Introducing new shadcn primitives or new tRPC procedures beyond the three named here.
- Adding region routing, token rotation, K8s/Railway provisioners, durable queues — all explicit non-goals.
- Editing anything under `openspec/`. The spec is final.

ACCEPTANCE
- All your `todos[].id` flipped to `status: done` in plan.md frontmatter, matching body `- [ ]` → `- [x]`.
- All TESTS run green; per-batch verification gate green.
- Plan `last_updated` bumped to the ISO timestamp of your last commit.
- (Final-batch only) `pnpm openspec validate add-instance-auto-provisioning --strict` green.
```

## Done Criteria

- [ ] All `todos` in frontmatter are `status: done` and matching body checklists are `[x]`.
- [ ] All 4 test todos (`slug-helper-test`, `provisioner-tests`, `trpc-router-tests`, `cleanup-tests`) landed and green BEFORE their corresponding impl todos (TDD evidence in git history).
- [ ] `pnpm -r typecheck` green.
- [ ] `pnpm -r test` green.
- [ ] `pnpm openspec validate add-instance-auto-provisioning --strict` green.
- [ ] Manual smoke (Coder I / coordinator): provision → HEALTHY, retry recovers from failure, deprovision tears down Fly machine (mock OK if FLY_API_TOKEN absent), `(orgId, env)` collision → 409 CONFLICT.
- [ ] BYO path `instance.register` is byte-for-byte identical to pre-change (`git diff` confirms zero edits inside its `.mutation(...)` body and schema).
- [ ] OpenSpec tasks: every checkbox in `openspec/changes/add-instance-auto-provisioning/tasks.md` (sections 1.1–9.6) is `- [x]` before archival.

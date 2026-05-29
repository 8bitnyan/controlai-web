---
name: "EC2 container provisioner (Ec2ContainerProvisioner)"
overview: "Replace the FlyProvisioner drift with a real ECS-on-EC2 bin-packed daemon backend in ap-northeast-2 behind a Caddy reverse-proxy pool + ALB + wildcard ACM cert. Add a new `packages/infra/` AWS CDK app (Network/Ecs/Dns/Ingress/Monitoring stacks). Add AWS SDK calls in the provisioner module. Add orphan-reconciliation pass to the hourly cleanup cron. Bump provision SLA to 90s server / 120s UI. Enrich audit metadata. Update docs and env-example. Operator-only AWS account prep + CDK deploy + production cutover are flagged out of coder scope."
created: "2026-05-28T07:55:00Z"
last_updated: "2026-05-28T07:55:00Z"
isProject: false
type: "spec"
change_id: "add-ec2-container-provisioner"
plan_status: "draft"
trigger: "spec apply openspec/changes/add-ec2-container-provisioner"
todos:
  # Section 1 — AWS account prep + ECR (OPERATOR-ONLY)
  - id: op-1-1-aws-profile
    content: "OPERATOR: Confirm AWS account ID + configure CLI profile `controlai`"
    status: pending
  - id: op-1-2-cdk-bootstrap
    content: "OPERATOR: `cdk bootstrap aws://<account>/ap-northeast-2` (one-time)"
    status: pending
  - id: op-1-3-dns-delegation
    content: "OPERATOR: Delegate `daemons.controlai.io` NS records from parent zone to Route53 after first DnsStack deploy"
    status: pending
  - id: op-1-4-ecr-push
    content: "OPERATOR: First-time push of `controlai-daemon:stable` image to ECR repo (CDK creates the repo)"
    status: pending
  # Section 2 — CDK infrastructure
  - id: 2-1-infra-workspace
    content: "Create `packages/infra/` pnpm workspace package shell (package.json, pnpm-workspace.yaml entry)"
    status: pending
  - id: 2-2-infra-deps-tooling
    content: "Add CDK deps + cdk.json + tsconfig.json + bin/cdk.ts entry + package.json scripts (synth/diff/deploy)"
    status: pending
  - id: 2-3-network-stack
    content: "Implement `lib/network-stack.ts` (VPC 10.20.0.0/16 + 2 AZs + 1 NAT + VPC endpoints)"
    status: pending
  - id: 2-4-ecs-stack
    content: "Implement `lib/ecs-stack.ts` (cluster + ASG + capacity provider + IAM roles + KMS + ECR + log group + daemon SG)"
    status: pending
  - id: 2-5-dns-stack
    content: "Implement `lib/dns-stack.ts` (hosted zone + wildcard ACM cert with DNS validation)"
    status: pending
  - id: 2-6-ingress-stack
    content: "Implement `lib/ingress-stack.ts` (ALB + Caddy Fargate service + ALB alias record + Cloud Map namespace + service)"
    status: pending
  - id: 2-7-monitoring-stack
    content: "Implement `lib/monitoring-stack.ts` (SNS topic + CW alarms for CPU/Memory/ALB-5xx/Caddy events)"
    status: pending
  - id: 2-8-bin-wiring-ssm
    content: "Wire stacks in `bin/cdk.ts` (constructor-props refs + SSM StringParameter outputs under `/controlai/infra/*`)"
    status: pending
  - id: 2-9-ci-synth-smoke
    content: "Add `pnpm --filter @controlai-web/infra synth` (+ `cdk diff`) as CI smoke step (never deploys)"
    status: pending
  - id: op-2-10-cdk-deploy
    content: "OPERATOR: Run `cdk deploy --all`; record stack output values in `apps/web/.env.local` + password manager"
    status: pending
  # Section 3 — AWS SDK deps
  - id: 3-1-api-aws-deps
    content: "Add `@aws-sdk/client-ecs`, `@aws-sdk/client-secrets-manager`, `@aws-sdk/client-service-discovery`, devDep `aws-sdk-client-mock` to `packages/api/package.json`"
    status: pending
  - id: 3-2-pnpm-install-baseline
    content: "`pnpm install` (no peer-dep warnings) + `pnpm -r typecheck` baseline GREEN"
    status: pending
  # Section 4 — Provisioner module (TDD)
  - id: 4-1-provisioner-tests-first
    content: "Write tests FIRST for MockProvisioner (unchanged), Ec2ContainerProvisioner (happy + sad paths), factory branches (mock/ec2/fly-rejected/unknown). DELETE all Fly tests."
    status: pending
  - id: 4-2-tests-red
    content: "Confirm new tests are RED (`pnpm --filter @controlai-web/api test -- instance-provisioner`)"
    status: pending
  - id: 4-3-impl-ec2-provisioner
    content: "Implement `Ec2ContainerProvisioner` class in `instance-provisioner.ts` (constructor env reads, lazy SDK clients, provision(), deprovision(), mapAwsError helper, AWS tags)"
    status: pending
  - id: 4-4-factory-rewrite-remove-fly
    content: "Rewrite `getProvisioner()` factory (mock | ec2 | reject 'fly' | reject unknown) + DELETE `FlyProvisioner` class + all FLY_* env reads"
    status: pending
  - id: 4-5-tests-green
    content: "Re-run provisioner test suite, confirm GREEN"
    status: pending
  - id: 4-6-api-typecheck-green
    content: "`pnpm --filter @controlai-web/api typecheck` GREEN"
    status: pending
  # Section 5 — Background task SLA
  - id: 5-1-provision-task-sla
    content: "Increase total provision-task budget guard to 90s in `provision-task.ts` (preserve mock skip-health branch + console.error logging)"
    status: pending
  # Section 6 — UI poll cap
  - id: 6-1-ui-poll-cap-120s
    content: "Change `60_000` → `120_000` in `provision-instance-dialog.tsx` + update timeout message text to the new copy"
    status: pending
  # Section 7 — Orphan reconciliation cron (TDD)
  - id: 7-1-orphan-cron-tests-first
    content: "Write tests FIRST in `apps/web/lib/cron/__tests__/orphan-reconciliation.test.ts` (5 scenarios)"
    status: pending
  - id: 7-2-orphan-cron-impl
    content: "Implement `reconcileOrphans(prisma, now)` in `apps/web/lib/cron/cleanup-failed-provisions.ts` (ListTasks + DescribeTasks + cross-reference DB + `instance.orphanCleanup` audit)"
    status: pending
  - id: 7-3-orphan-cron-instrumentation
    content: "Wire second `setInterval(reconcileOrphans, 60*60*1000)` in `apps/web/instrumentation.ts` with new single-shot symbol guard"
    status: pending
  - id: 7-4-orphan-tests-green
    content: "Orphan-cron tests GREEN"
    status: pending
  # Section 8 — Env-var bootstrap
  - id: 8-1-env-example-rewrite
    content: "Update `apps/web/.env.example`: REPLACE FLY_* block with AWS block (per proposal Env vars section); update DAEMON_IMAGE comment to ECR; INSTANCE_PROVISIONER values now `mock | ec2`"
    status: pending
  # Section 9 — Audit-log metadata
  - id: 9-1-audit-provision-metadata
    content: "Extend `instance.provision` audit metadata in `provision-task.ts` to include AWS fields (`awsRegion`, `taskArn`, `secretArn`) when backend is `ec2`"
    status: pending
  - id: 9-2-audit-provision-failed-metadata
    content: "Extend `instance.provisionFailed` audit metadata in `provision-task.ts` (`awsRegion?`, `taskArn?` when backend=ec2)"
    status: pending
  - id: 9-3-audit-deprovision-metadata
    content: "Extend `instance.deprovision` audit metadata in `instance.ts` router (`awsRegion?`, `taskArn?` when backend=ec2)"
    status: pending
  - id: 9-4-audit-orphan-cleanup-action
    content: "Add new audit action `instance.orphanCleanup` emitted from orphan-cron with metadata `{ taskArn, secretArn, reason }`"
    status: pending
  # Section 10 — Docs
  - id: 10-1-ec2-setup-doc
    content: "Write `docs/ec2-container-provisioner-setup.md` (AWS prep + bootstrap + deploy + env mapping + DNS delegation + ECR push + smoke test + rollback + mermaid)"
    status: pending
  - id: 10-2-instance-provisioning-rewrite
    content: "Rewrite Fly section of `docs/instance-provisioning.md` → EC2 section (env table + state machine adds orphan-cron path + troubleshooting matrix)"
    status: pending
  - id: 10-3-byo-vs-managed-refresh
    content: "Minor refresh of `docs/instance-byo-vs-managed.md` to name EC2 as managed backend"
    status: pending
  # Section 11 — Verification (automated)
  - id: 11-1-api-typecheck
    content: "`pnpm --filter @controlai-web/api typecheck` GREEN"
    status: pending
  - id: 11-2-api-test
    content: "`pnpm --filter @controlai-web/api test` GREEN (includes new EC2 + factory tests)"
    status: pending
  - id: 11-3-web-typecheck
    content: "`pnpm --filter ./apps/web typecheck` GREEN"
    status: pending
  - id: 11-4-web-test
    content: "`pnpm --filter ./apps/web test` GREEN (includes orphan-cron tests)"
    status: pending
  - id: 11-5-infra-synth
    content: "`pnpm --filter @controlai-web/infra synth` GREEN (CDK synth-only, no AWS calls)"
    status: pending
  - id: 11-6-monorepo-typecheck-test
    content: "`pnpm -r typecheck && pnpm -r test` GREEN across monorepo"
    status: pending
  - id: 11-7-openspec-validate
    content: "`pnpm openspec validate add-ec2-container-provisioner --strict` GREEN"
    status: pending
  - id: op-11-8-manual-smoke
    content: "OPERATOR: Manual smoke test in AWS sandbox (deploy + provision + URL hit + deprovision + force-fail + orphan scenario)"
    status: pending
  - id: 11-9-byo-doc-refresh
    content: "Update `docs/instance-byo-vs-managed.md` if any comparison facts changed (covered by 10-3 if applicable; otherwise no-op verify)"
    status: pending
  # Section 12 — Post-merge cutover (OPERATOR-ONLY)
  - id: op-12-1-prod-cdk-deploy
    content: "OPERATOR: Production CDK deploy in real AWS account"
    status: pending
  - id: op-12-2-flip-instance-provisioner
    content: "OPERATOR: Flip production `INSTANCE_PROVISIONER=ec2`"
    status: pending
  - id: op-12-3-customer-announce
    content: "OPERATOR: Announce mock-instance migration requirement to customers"
    status: pending
  - id: op-12-4-monitor-24h
    content: "OPERATOR: Monitor 24h via CloudWatch + audit-log review"
    status: pending
---

# Plan: EC2 container provisioner (Ec2ContainerProvisioner)

## Background & Research

External library/API references (researcher outputs — coders should open these):

- AWS SDK v3 + aws-sdk-client-mock + Caddy admin API → `.slash/workspace/research/spec-add-ec2-container-provisioner-aws-sdk.md`
- AWS CDK v2 stack patterns (Network/Ecs/Dns/Ingress/Monitoring) → `.slash/workspace/research/spec-add-ec2-container-provisioner-cdk.md`

OpenSpec source (READ-ONLY input; coder must read all three before starting Section 4):

- `openspec/changes/add-ec2-container-provisioner/proposal.md`
- `openspec/changes/add-ec2-container-provisioner/design.md` (esp. §10 provision flow + §11 deprovision flow + §IAM appendix)
- `openspec/changes/add-ec2-container-provisioner/tasks.md`
- `openspec/changes/add-ec2-container-provisioner/specs/instance-management/spec.md` (the 5 MODIFIED + ADDED requirements with scenarios)

### B1. Current `packages/api/src/lib/instance-provisioner.ts` (FULL — coder rewrites in place)

File: `packages/api/src/lib/instance-provisioner.ts` (153 lines). KEEP interfaces + ProvisionerError + MockProvisioner. DELETE FlyProvisioner (lines 49-138). REWRITE getProvisioner() (lines 142-153). ADD Ec2ContainerProvisioner.

```ts
import crypto from 'node:crypto';

export interface ProvisionArgs { orgId: string; orgSlug: string; subdomain: string; env: 'prod' | 'staging' | 'dev'; onProgress?: (stage: string, percent: number, message: string) => void }
export interface ProvisionResult { bearerToken: string; baseURL: string; ready: boolean; provisionerInstanceId: string }
export interface DeprovisionArgs { provisionerInstanceId: string; baseURL: string }
export interface InstanceProvisioner {
  readonly backend: string;
  provision(a: ProvisionArgs): Promise<ProvisionResult>;
  deprovision(a: DeprovisionArgs): Promise<void>;
}

export class ProvisionerError extends Error {
  constructor(public readonly code: string, message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ProvisionerError';
  }
}

export class MockProvisioner implements InstanceProvisioner {
  readonly backend = 'mock';
  // ... (unchanged — 5-stage progress: preparing 5%, allocating 25%, token 50%, dns 75%, finalizing 95%)
}

// DELETE entire FlyProvisioner class (currently lines 49-138)

// REWRITE factory (currently lines 142-153)
let cached: InstanceProvisioner | null = null;
export function getProvisioner(): InstanceProvisioner {
  if (cached) return cached;
  const selected = process.env.INSTANCE_PROVISIONER;
  // new branching logic — see plan task 4-4
  ...
}
```

Required factory behavior (per spec deltas):

- unset or `'mock'` → MockProvisioner
- `'ec2'` → Ec2ContainerProvisioner (throws if any required env var missing — listed in B2 below)
- `'fly'` → `throw new Error("INSTANCE_PROVISIONER=fly is no longer supported; the FlyProvisioner was removed in add-ec2-container-provisioner. Use 'mock' or 'ec2'.")`
- anything else → throw listing supported values

### B2. Ec2ContainerProvisioner env-var contract (constructor reads — all required when backend=ec2)

```
AWS_REGION, AWS_ACCOUNT_ID, ECS_CLUSTER_NAME, ECS_TASK_FAMILY,
ECS_TASK_ROLE_ARN, ECS_EXECUTION_ROLE_ARN, ECS_SECURITY_GROUP_ID,
ECS_SUBNETS (csv → split into string[]),
CADDY_ADMIN_ENDPOINT, SECRETS_KMS_KEY_ARN,
DAEMON_IMAGE, DAEMON_BASE_DOMAIN, DAEMON_LOG_GROUP,
CLOUD_MAP_NAMESPACE_ID (optional — Cloud Map Service ID actually required; see AWS SDK research §7)
```

onProgress stage table (must emit monotonically increasing percent 5..90; final 95% emitted by provision-task):

| stage              | percent | when                                        |
|--------------------|---------|---------------------------------------------|
| creating_secret    | 5       | before SecretsManager CreateSecret          |
| registering_taskdef| 15      | before RegisterTaskDefinition               |
| creating_service   | 25      | before CreateService                        |
| waiting_for_task   | 40..75  | DescribeTasks polling loop (linear scale)   |
| registering_dns    | 80      | before Cloud Map RegisterInstance           |
| configuring_caddy  | 85      | before Caddy POST /config/...               |

### B3. Current test file (`packages/api/src/lib/__tests__/instance-provisioner.test.ts`)

165 lines. KEEP MockProvisioner suite (lines 24-46). KEEP factory-mock + factory-mock-default tests (lines 51-62). DELETE all Fly-related tests (lines 64-79 factory-fly + 82-164 FlyProvisioner suite). REPLACE with EC2 tests using `aws-sdk-client-mock`.

Existing test infrastructure to reuse:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
// vi.resetModules() — reset module cache between env-var tests
// vi.spyOn(globalThis, 'fetch').mockImplementation(...) — for Caddy admin API
// vi.useFakeTimers() + vi.advanceTimersByTimeAsync(60_000) — for the 60s task-RUNNING timeout
// vi.stubGlobal('fetch', vi.fn()) — alternative pattern from aws-sdk research

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete process.env.INSTANCE_PROVISIONER;
  // ... delete all FLY_* (legacy), AWS_*, ECS_*, CADDY_*, SECRETS_*, DAEMON_*
});
```

Test scenarios required (per tasks.md 4.1.1 → 4.1.14):

- 4.1.1 MockProvisioner shape + monotonic progress (KEEP).
- 4.1.2 Ec2 happy: 6 SDK happy-path mocks + fetch mocks for Caddy + daemon health → returns expected shape + asserts onProgress sequence matches the B2 table.
- 4.1.3 ECS CreateService throws CapacityProviderException → ProvisionerError('INSUFFICIENT_CAPACITY'). Cleanup: secret should be deleted.
- 4.1.4 DescribeTasks lastStatus=STOPPED with stoppedReason containing 'CannotPullContainerError' → ProvisionerError('IMAGE_PULL_FAILED'). Cleanup: service + task def deregistered.
- 4.1.5 DescribeTasks never reaches RUNNING within 60s budget (use fake timers, resolve with PENDING repeatedly) → ProvisionerError('TASK_FAILED_TO_START').
- 4.1.6 Caddy admin POST returns 500 → ProvisionerError('CADDY_ROUTE_ADD_FAILED').
- 4.1.7 CreateSecret returns ResourceExistsException → idempotent: UpdateSecret with new value, continue normally.
- 4.1.8 deprovision happy: asserts Caddy DELETE → ECS UpdateService(desired=0) → DeleteService(force=true) → CloudMap DeregisterInstance → SecretsManager DeleteSecret(forceDeleteWithoutRecovery=true) each called exactly once.
- 4.1.9 deprovision tolerates Caddy 404 + SecretsManager ResourceNotFoundException (idempotent).
- 4.1.10 Factory `INSTANCE_PROVISIONER='ec2'` with all env vars set → `.backend === 'ec2'`.
- 4.1.11 Factory `INSTANCE_PROVISIONER='ec2'` missing AWS_REGION / ECS_CLUSTER_NAME / ECS_TASK_ROLE_ARN → throws naming the missing var(s).
- 4.1.12 Factory `INSTANCE_PROVISIONER='fly'` → throws the exact message in B1.
- 4.1.13 Factory `INSTANCE_PROVISIONER='unknown'` → throws listing supported values.
- 4.1.14 DELETE all existing Fly test cases.

### B4. `packages/api/src/lib/provision-task.ts` (74 lines — extend audit metadata + SLA)

Currently:

```ts
// success path (line ~60)
void writeAudit(prisma, { orgId: args.orgId, action: 'instance.provision', targetId: instanceId, targetType: 'ControlaiInstance',
  metadata: { env: args.env, baseURL: args.baseURL, provisionerBackend: provisioner.backend } });

// failure path (line ~67)
void writeAudit(prisma, { orgId: args.orgId, action: 'instance.provisionFailed', targetId: instanceId, targetType: 'ControlaiInstance',
  metadata: { env: args.env, error: { code, message }, provisionerBackend: provisioner.backend } });
```

Required:

- Add SLA guard: wrap the `provisioner.provision(...)` call in a `Promise.race` against a 90s timer that throws `ProvisionerError('MACHINE_START_TIMEOUT', 'Provision SLA exceeded (90s)')`. Mock branch unaffected — MockProvisioner is fast.
- When `provisioner.backend === 'ec2'`, enrich metadata with `awsRegion: process.env.AWS_REGION`, `taskArn: result.provisionerInstanceId`, and (if exposed via a result hook or fetched) `secretArn: <reconstructed from instanceId>`. For provisionFailed, include `awsRegion` and `taskArn?` (may be undefined if failure was pre-CreateService).
- Keep mock branch + `version = 'mock-0.0.0'` untouched.
- Keep `console.error('[provision-task] failed', ...)` line already present.

### B5. `packages/api/src/routers/instance.ts` deprovision (line 306-327 — extend audit metadata)

Currently:

```ts
void writeAudit(ctx.prisma, { orgId: instance.orgId, userId: ctx.userId, action: 'instance.deprovision', targetId: instance.id, targetType: 'ControlaiInstance',
  metadata: { provisionerBackend: provisioner.backend, env: instance.env } });
```

Required (Section 9.3): when backend=ec2, add `awsRegion: process.env.AWS_REGION` and `taskArn: instance.provisionerInstanceId` to metadata.

### B6. `apps/web/lib/cron/cleanup-failed-provisions.ts` (63 lines — ADD orphan pass)

Current exported function: `runCleanupTick(prisma, now?)` returns `{ scanned, deleted, skipped }`. Uses `prisma.controlaiInstance.findMany` for failed-24h cleanup. Imports `getProvisioner` + `writeAudit` from `@controlai-web/api`.

ADD a new exported function in the same file:

```ts
export async function reconcileOrphans(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<{ scanned: number; deleted: number; skipped: number; errors: number }> {
  const provisioner = getProvisioner();
  if (provisioner.backend !== 'ec2') return { scanned: 0, deleted: 0, skipped: 0, errors: 0 };

  // 1. ListTasks(cluster: ECS_CLUSTER_NAME) — paginate
  // 2. DescribeTasks(tasks: taskArns, include: ['TAGS']) — read tag controlai:instance-id
  // 3. SELECT id FROM ControlaiInstance WHERE id IN (<tagged ids>)
  // 4a. For each tagged task with NO DB row: synthesize DeprovisionArgs from tags + provisioner.deprovision(),
  //     then writeAudit(action: 'instance.orphanCleanup', metadata: { taskArn, secretArn, reason: 'no-db-row' })
  // 4b. SELECT * FROM ControlaiInstance WHERE status='PROVISIONING' AND provisioningStartedAt < now - 10min
  //     → for each with no matching live task: mark PROVISION_FAILED, append progress-log
  //       entry '[ORPHAN_RECONCILIATION] Provisioning timed out — no live ECS task',
  //       writeAudit(action: 'instance.orphanCleanup', metadata: { reason: 'stuck-provisioning' })
  // Errors from AWS SDK: console.error, increment `errors` counter, continue.
}
```

Test scenarios in NEW file `apps/web/lib/cron/__tests__/orphan-reconciliation.test.ts`:

- 7.1.1 ECS task list matches DB exactly → returns counts all 0.
- 7.1.2 ECS task tagged `controlai-instance-id=abc` with no DB row → calls `provisioner.deprovision()` + writes `instance.orphanCleanup` audit with `reason: 'no-db-row'`.
- 7.1.3 DB row status=PROVISIONING > 10 min, no live task → updates row to PROVISION_FAILED, appends log entry, writes `instance.orphanCleanup` audit with `reason: 'stuck-provisioning'`.
- 7.1.4 Mock backend → reconcileOrphans returns early with all-zero counts, makes no AWS calls.
- 7.1.5 AWS SDK throws ThrottlingException mid-iteration → logged, counts.errors++, partial result returned.

Reuse the existing test mocking pattern from `cleanup-failed-provisions.test.ts`:

```ts
import { vi } from 'vitest';
const { deprovision, writeAudit, getProvisioner } = vi.hoisted(() => ({
  deprovision: vi.fn(),
  writeAudit: vi.fn(),
  getProvisioner: vi.fn(),
}));
vi.mock('@controlai-web/api', () => ({ getProvisioner, writeAudit }));
// + aws-sdk-client-mock for ECSClient as documented in research
```

### B7. `apps/web/instrumentation.ts` (19 lines — ADD second scheduler)

Currently:

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const key = Symbol.for('controlai.cleanup-failed-provisions.scheduled');
  if ((globalThis as Record<symbol, boolean>)[key]) return;
  (globalThis as Record<symbol, boolean>)[key] = true;
  const { runCleanupTick } = await import('./lib/cron/cleanup-failed-provisions');
  const { prisma } = await import('@controlai-web/db');
  const tick = () => { void runCleanupTick(prisma).catch((e) => console.error('[cleanup-tick]', e)); };
  setInterval(tick, 60 * 60 * 1000);
  tick();
}
```

Required addition (Section 7.3): add a SECOND single-shot symbol guard + setInterval for `reconcileOrphans`. Use distinct symbol `Symbol.for('controlai.reconcile-orphans.scheduled')`. Both ticks should be wired in the same `register()` call. Mirror the existing tick pattern exactly. Same 60-minute interval.

### B8. `apps/web/components/instances/provision-instance-dialog.tsx` (276 lines — ONLY change the poll cap)

Two literal edits required (Section 6):

1. Line ~83 (inside the polling-timeout `useEffect`): change `60_000` → `120_000`.
2. Line ~84 (the `setErrorMsg('Provisioning timed out. ...')` string): replace with `'Provisioning is taking longer than expected (>2 min). Check the AWS console for ECS task status, or wait and refresh.'`

No other UI changes — `ProgressBlock` already renders any stage name + percent the new EC2 stages emit.

### B9. `apps/web/.env.example` (57 lines — REPLACE FLY block)

Current lines 48-57 (the daemon-provisioning block) contain:

```
DAEMON_BASE_DOMAIN=daemons.controlai.io
NEXT_PUBLIC_DAEMON_BASE_DOMAIN=daemons.controlai.io
INSTANCE_PROVISIONER=mock
# Required only when INSTANCE_PROVISIONER=fly
FLY_API_TOKEN=
FLY_ORG_SLUG=
FLY_APP_NAME_PREFIX=controlai-daemon
FLY_REGION=iad
DAEMON_IMAGE=ghcr.io/controlai/daemon:stable
```

Replace lines 51-57 (the FLY_* block + `DAEMON_IMAGE`) with (Section 8.1):

```
# Required only when INSTANCE_PROVISIONER=ec2
AWS_REGION=ap-northeast-2
AWS_ACCOUNT_ID=
ECS_CLUSTER_NAME=controlai-daemons
ECS_TASK_FAMILY=controlai-daemon
ECS_TASK_ROLE_ARN=
ECS_EXECUTION_ROLE_ARN=
ECS_SECURITY_GROUP_ID=
ECS_SUBNETS=subnet-,subnet-
CADDY_ADMIN_ENDPOINT=http://caddy.daemons.local:2019
SECRETS_KMS_KEY_ARN=
DAEMON_LOG_GROUP=/aws/ecs/controlai-daemons
# Update DAEMON_IMAGE to ECR (replace <account>):
DAEMON_IMAGE=<account>.dkr.ecr.ap-northeast-2.amazonaws.com/controlai-daemon:stable
```

Keep `INSTANCE_PROVISIONER=mock` line; only update its comment to "supported values: mock | ec2".

### B10. Existing audit-writer helper (do NOT change)

`packages/api/src/lib/audit-writer.ts`:

```ts
export async function writeAudit(db: PrismaClient, input: WriteAuditInput): Promise<void>
export interface WriteAuditInput {
  orgId: string; userId?: string | null; action: string;
  targetId?: string | null; targetType?: string | null;
  metadata?: Record<string, unknown> | null;
}
```

Fire-and-forget. Never throws. Reuse as-is for `instance.orphanCleanup` action.

### B11. CDK app skeleton (`packages/infra/`)

See `.slash/workspace/research/spec-add-ec2-container-provisioner-cdk.md` for full snippets per stack. The 5 stacks must be wired in `bin/cdk.ts` via constructor-props (not `Fn.import_value`) in this order:

```ts
const app = new cdk.App();
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'ap-northeast-2' };
const network = new NetworkStack(app, 'controlai-network', { env });
const ecs = new EcsStack(app, 'controlai-ecs', { env, vpc: network.vpc });
const dns = new DnsStack(app, 'controlai-dns', { env });
const ingress = new IngressStack(app, 'controlai-ingress', { env, vpc: network.vpc, certificate: dns.cert, hostedZone: dns.hostedZone, cluster: ecs.cluster });
new MonitoringStack(app, 'controlai-monitoring', { env, cluster: ecs.cluster, alb: ingress.alb });
```

Required SSM outputs (Section 2.8) under `/controlai/infra/*`: `ECS_CLUSTER_NAME`, `ECS_TASK_ROLE_ARN`, `ECS_EXECUTION_ROLE_ARN`, `ECS_SECURITY_GROUP_ID`, `ECS_SUBNETS` (csv via `cdk.Fn.join`), `CADDY_ADMIN_ENDPOINT`, `SECRETS_KMS_KEY_ARN`, `DAEMON_LOG_GROUP`, `CLOUD_MAP_NAMESPACE_ID`, `CLOUD_MAP_SERVICE_ID`.

`packages/infra/package.json` name: `@controlai-web/infra` (matches the filter pattern in tasks.md).

### B12. Existing `pnpm-workspace.yaml` (3 lines)

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

No edit required — `packages/*` glob already picks up the new `packages/infra/` once created.

## Testing Plan

(TDD-first within the Provisioner + Cron slices; all other testing is "must remain green".)

- [ ] `4-1-provisioner-tests-first`: Write the full provisioner test suite (13 scenarios above) BEFORE touching implementation.
- [ ] `4-2-tests-red`: Confirm RED.
- [ ] `4-5-tests-green`: After implementation, GREEN.
- [ ] `7-1-orphan-cron-tests-first`: Write the 5 orphan-cron scenarios BEFORE touching implementation.
- [ ] `7-4-orphan-tests-green`: After implementation, GREEN.
- [ ] `11-1-api-typecheck`: `pnpm --filter @controlai-web/api typecheck` GREEN.
- [ ] `11-2-api-test`: `pnpm --filter @controlai-web/api test` GREEN.
- [ ] `11-3-web-typecheck`: `pnpm --filter ./apps/web typecheck` GREEN.
- [ ] `11-4-web-test`: `pnpm --filter ./apps/web test` GREEN.
- [ ] `11-5-infra-synth`: `pnpm --filter @controlai-web/infra synth` GREEN (synth-only, no AWS creds needed).
- [ ] `11-6-monorepo-typecheck-test`: `pnpm -r typecheck && pnpm -r test` GREEN.
- [ ] `11-7-openspec-validate`: `pnpm openspec validate add-ec2-container-provisioner --strict` GREEN.
- [ ] `11-9-byo-doc-refresh`: Re-read `docs/instance-byo-vs-managed.md` and verify no stale comparison facts remain after Section 10.

## Implementation Plan

Note: tasks 1.x / 2.10 / 11.8 / 12.x are OPERATOR-ONLY and listed for completeness — coder agents do NOT execute them. They're tracked in frontmatter with the `op-` id prefix so the orchestrator can flag them to the user.

### Section 1 — AWS account prep (OPERATOR-ONLY)

- [ ] `op-1-1-aws-profile`: OPERATOR — confirm AWS account ID + configure `aws configure --profile controlai`.
- [ ] `op-1-2-cdk-bootstrap`: OPERATOR — `cdk bootstrap aws://<account>/ap-northeast-2`.
- [ ] `op-1-3-dns-delegation`: OPERATOR — delegate `daemons.controlai.io` from parent zone to new Route53 zone (NS records extracted after first DnsStack deploy).
- [ ] `op-1-4-ecr-push`: OPERATOR — first-time push `controlai-daemon:stable` to ECR repo (CDK creates the repo).

### Section 2 — CDK infrastructure (`packages/infra/`)

- [ ] `2-1-infra-workspace`: Create `packages/infra/` directory; create `package.json` with `name: @controlai-web/infra`, `private: true`. No edit to `pnpm-workspace.yaml` needed (already covers `packages/*`).
- [ ] `2-2-infra-deps-tooling`: Add deps (`aws-cdk-lib@^2`, `constructs@^10`), devDeps (`aws-cdk@^2`, `typescript`, `@types/node`, `tsx`); add `cdk.json` (`"app": "npx tsx bin/cdk.ts"`), `tsconfig.json` (target ES2022 / module commonjs, strict), and `bin/cdk.ts` skeleton; add scripts: `synth`, `diff`, `deploy`, `deploy:all`. Refer to research doc §1.
- [ ] `2-3-network-stack`: Implement `lib/network-stack.ts` — VPC 10.20.0.0/16, 2 AZs, 1 NAT gateway in az-a, public+private subnet groups, VPC endpoints (ECR API + ECR Docker + Secrets Manager + CloudWatch Logs interface; S3 gateway). Export `vpc` property.
- [ ] `2-4-ecs-stack`: Implement `lib/ecs-stack.ts` — Cluster `controlai-daemons`, ASG (`t3.medium`, `EcsOptimizedImage.amazonLinux2()`, min=1 max=10), `AsgCapacityProvider` + `cluster.addAsgCapacityProvider()`, Role `controlai-daemon-task-role` (empty), Role `controlai-daemon-execution-role` (Secrets Manager scoped + KMS Decrypt + ECR + Logs managed policy + inline), KMS Key for daemon secrets, ECR Repository `controlai-daemon` with lifecycle keep-10, LogGroup `/aws/ecs/controlai-daemons` retention 30 days, daemon SecurityGroup (egress 443/1883/8883, ingress later from Caddy SG). Export `cluster`, `taskRole`, `executionRole`, `daemonSg`, `kmsKey`, `logGroup`, `repository`.
- [ ] `2-5-dns-stack`: Implement `lib/dns-stack.ts` — HostedZone `daemons.controlai.io`, Certificate `*.daemons.controlai.io` with `CertificateValidation.fromDns(hostedZone)`. Export `hostedZone`, `cert`.
- [ ] `2-6-ingress-stack`: Implement `lib/ingress-stack.ts` — ApplicationLoadBalancer (internet-facing, HTTPS listener with cert + default forward to Caddy TG, HTTP listener redirect→HTTPS); Caddy `FargateService` (2 replicas, custom Caddy image with admin API on port 2019 bound to daemons.local) + ApplicationTargetGroup; daemon SG ingress from Caddy SG; Route53 `ARecord('*.daemons.controlai.io', RecordTarget.fromAlias(new LoadBalancerTarget(alb)))`; `PrivateDnsNamespace('daemons.local', vpc)` from `aws-cdk-lib/aws-servicediscovery` + a Cloud Map `Service` in that namespace for SRV records. Export `alb`, `caddyAdminEndpoint` (string `http://caddy.daemons.local:2019`), `cloudMapServiceId`, `cloudMapNamespaceId`.
- [ ] `2-7-monitoring-stack`: Implement `lib/monitoring-stack.ts` — SNS Topic `controlai-daemons-alerts`; CloudWatch alarms via `cluster.metricCpuUtilization()` >80, `cluster.metricMemoryUtilization()` >80, `alb.metrics.httpCodeElb(HttpCodeElb.ELB_5XX_COUNT)` >10 (5min); EventBridge rule for Caddy service deployment-failed events → SNS. All alarms `addAlarmAction(new SnsAction(topic))`.
- [ ] `2-8-bin-wiring-ssm`: Wire all 5 stacks in `bin/cdk.ts` via constructor props (per research doc §7). Add `ssm.StringParameter` for each output listed in B11 (10 parameters under `/controlai/infra/*`). Use `cdk.Fn.join(',', subnetIds)` for `ECS_SUBNETS`.
- [ ] `2-9-ci-synth-smoke`: Add `pnpm --filter @controlai-web/infra synth` (and optionally `cdk diff`) to whatever CI workflow runs typecheck/test. Synth only, no creds needed. Document `cdk synth --quiet` flag.
- [ ] `op-2-10-cdk-deploy`: OPERATOR — `cdk deploy --all`; record stack outputs in `apps/web/.env.local` + team password manager.

### Section 3 — AWS SDK dependencies

- [ ] `3-1-api-aws-deps`: Edit `packages/api/package.json` — add deps `@aws-sdk/client-ecs@^3`, `@aws-sdk/client-secrets-manager@^3`, `@aws-sdk/client-service-discovery@^3`; add devDep `aws-sdk-client-mock@^4`. (Also add `@aws-sdk/client-ec2@^3` — `DescribeInstances` needed to resolve EC2 private IP from `containerInstanceArn`, per AWS SDK research §4.)
- [ ] `3-2-pnpm-install-baseline`: Run `pnpm install` at repo root; verify no peer-dep warnings. Run `pnpm -r typecheck` → baseline GREEN.

### Section 4 — Provisioner module (TDD, `packages/api/`)

- [ ] `4-1-provisioner-tests-first`: REWRITE `packages/api/src/lib/__tests__/instance-provisioner.test.ts`. KEEP MockProvisioner suite (lines 24-46) and factory-mock + factory-mock-default (lines 51-62). DELETE all Fly tests. ADD the 13 scenarios from B3 using `mockClient(ECSClient)`, `mockClient(SecretsManagerClient)`, `mockClient(ServiceDiscoveryClient)` (+ `mockClient(EC2Client)` for the IP-resolution step) from `aws-sdk-client-mock`. Add `vi.stubGlobal('fetch', ...)` for Caddy POST + daemon `/v1/health`. `afterEach` cleanup must delete all new AWS_*, ECS_*, CADDY_*, SECRETS_*, DAEMON_* env vars in addition to legacy FLY_*.
- [ ] `4-2-tests-red`: `pnpm --filter @controlai-web/api test -- instance-provisioner` → expect RED with explicit failures naming Ec2ContainerProvisioner missing class.
- [ ] `4-3-impl-ec2-provisioner`: Add `Ec2ContainerProvisioner` class to `packages/api/src/lib/instance-provisioner.ts`. Constructor: read env vars listed in B2, throw at construction if any required missing (collect into a single error message). Lazy-init `ECSClient`, `SecretsManagerClient`, `ServiceDiscoveryClient`, `EC2Client` (cache as private fields). `provision()`: implement the 8-step flow from spec §10 — generate 32-byte hex token → CreateSecret with `KmsKeyId: SECRETS_KMS_KEY_ARN` + tags + `ResourceExistsException` → UpdateSecret fallback → RegisterTaskDefinition (bridge mode, `hostPort: 0`, secrets→Secrets Manager ARN, awslogs to `DAEMON_LOG_GROUP`, tags `controlai:cluster|org-id|env|instance-id`) → CreateService (EC2 launchType, capacity provider strategy, placement binpack/memory, propagateTags) → poll DescribeTasks until lastStatus=RUNNING (1s tick, 60s budget) → resolve assigned host IP via DescribeContainerInstances→DescribeInstances + host port from `networkBindings[0].hostPort` → RegisterInstance in Cloud Map (Attributes AWS_INSTANCE_IPV4 + AWS_INSTANCE_PORT) → fetch POST CADDY_ADMIN_ENDPOINT/config/apps/http/servers/srv0/routes/... with route JSON (handler reverse_proxy, upstreams [{dial:'<id>.daemons.local:<port>'}], match[{host: ['<subdomain>.<DAEMON_BASE_DOMAIN>']}]) → return `{bearerToken, baseURL:'https://<subdomain>.<DAEMON_BASE_DOMAIN>', ready:true, provisionerInstanceId:taskArn}`. Emit onProgress per B2 table. `deprovision()`: implement 4-step strict teardown from spec §11. Helper `mapAwsError(err): ProvisionerError` — switch on `err.name` for `ResourceNotFoundException`, `AccessDeniedException`, `CapacityProviderException`, fallback `UNKNOWN`.
- [ ] `4-4-factory-rewrite-remove-fly`: REWRITE `getProvisioner()` per B1 contract. DELETE entire FlyProvisioner class (~90 LOC). DELETE all FLY_* references in this file. Keep singleton caching.
- [ ] `4-5-tests-green`: Re-run, confirm GREEN.
- [ ] `4-6-api-typecheck-green`: `pnpm --filter @controlai-web/api typecheck` GREEN.

### Section 5 — Background task SLA bump

- [ ] `5-1-provision-task-sla`: In `packages/api/src/lib/provision-task.ts`, wrap the `provisioner.provision(...)` call (line ~26) with a 90s `Promise.race` timeout that rejects with `new ProvisionerError('MACHINE_START_TIMEOUT', 'Provision SLA exceeded (90s budget)')`. Health check timeout (line ~43) remains its current implicit 30s. Mock branch (line ~36 `if backend === 'mock'`) untouched. Preserve `console.error('[provision-task] failed', ...)`.

### Section 6 — UI poll cap

- [ ] `6-1-ui-poll-cap-120s`: In `apps/web/components/instances/provision-instance-dialog.tsx`, change `60_000` to `120_000` (line ~83); replace the timeout message string with `'Provisioning is taking longer than expected (>2 min). Check the AWS console for ECS task status, or wait and refresh.'`. No other edits.

### Section 7 — Orphan reconciliation cron (TDD)

- [ ] `7-1-orphan-cron-tests-first`: Create NEW file `apps/web/lib/cron/__tests__/orphan-reconciliation.test.ts` with the 5 scenarios from B6. Use `vi.hoisted` mock pattern from existing `cleanup-failed-provisions.test.ts`. Add `mockClient(ECSClient)` from `aws-sdk-client-mock`. Cover backend-mock no-op, exact-match no-op, orphan AWS-task cleanup with audit, stuck-PROVISIONING DB row → PROVISION_FAILED with audit, ThrottlingException → partial-counts result.
- [ ] `7-2-orphan-cron-impl`: ADD `reconcileOrphans(prisma, now?)` function to `apps/web/lib/cron/cleanup-failed-provisions.ts` per B6 sketch. Reuse `getProvisioner` + `writeAudit` imports. Pagination loop for `ListTasksCommand`. Tag-based cross-reference. Synthesize `DeprovisionArgs` for orphans from tags. Wrap each AWS call in try/catch incrementing `errors` counter on failure; never throw out of the function.
- [ ] `7-3-orphan-cron-instrumentation`: Edit `apps/web/instrumentation.ts` to add second symbol guard `Symbol.for('controlai.reconcile-orphans.scheduled')` + `setInterval(orphanTick, 60 * 60 * 1000)`. Both ticks live in the same `register()` call. Mirror existing pattern exactly.
- [ ] `7-4-orphan-tests-green`: `pnpm --filter ./apps/web test -- orphan-reconciliation` GREEN.

### Section 8 — Env-var bootstrap

- [ ] `8-1-env-example-rewrite`: Edit `apps/web/.env.example` lines 48-57 per B9. REMOVE all FLY_* keys. ADD the 11 AWS keys. UPDATE `DAEMON_IMAGE` comment + sample value to ECR. UPDATE `INSTANCE_PROVISIONER` comment to "supported values: mock | ec2".

### Section 9 — Audit-log metadata

- [ ] `9-1-audit-provision-metadata`: In `provision-task.ts` line ~60 (success audit), enrich `metadata` with `awsRegion: process.env.AWS_REGION`, `taskArn: result.provisionerInstanceId`, and `secretArn: \`arn:aws:secretsmanager:\${process.env.AWS_REGION}:\${process.env.AWS_ACCOUNT_ID}:secret:controlai/daemon/\${instanceId}/token\`` (only when `provisioner.backend === 'ec2'`).
- [ ] `9-2-audit-provision-failed-metadata`: In `provision-task.ts` line ~67 (failure audit), conditionally include `awsRegion` + `taskArn?` when backend is ec2 and value available (taskArn may be undefined if failure was pre-CreateService).
- [ ] `9-3-audit-deprovision-metadata`: In `packages/api/src/routers/instance.ts` line ~325 (deprovision audit), conditionally include `awsRegion: process.env.AWS_REGION` + `taskArn: instance.provisionerInstanceId` when `provisioner.backend === 'ec2'`.
- [ ] `9-4-audit-orphan-cleanup-action`: New audit action `instance.orphanCleanup` (no schema change — audit metadata is JSON). Emitted from `reconcileOrphans` in two branches: orphan-AWS-task `metadata: { taskArn, secretArn, reason: 'no-db-row' }`; stuck-PROVISIONING-row `metadata: { reason: 'stuck-provisioning', instanceId }`. (Covered by 7-2 implementation; this todo verifies metadata shape + adds the action string to any audit-action allowlist if one exists.)

### Section 10 — Docs

- [ ] `10-1-ec2-setup-doc`: Create `docs/ec2-container-provisioner-setup.md`. Cover: AWS account prep, `cdk bootstrap`, deploy order (Network→Ecs→Dns→Ingress→Monitoring), env-var mapping table (CDK output → controlai-web env var), DNS delegation steps, ECR push command, smoke-test checklist, rollback (flip `INSTANCE_PROVISIONER=mock`). Embed the mermaid provision flow from design.md §10.
- [ ] `10-2-instance-provisioning-rewrite`: Rewrite `docs/instance-provisioning.md` Fly section as EC2 section. Update env-var table (replace 4 FLY_* keys with 11 AWS keys). Update state-machine diagram to add the hourly orphan-cron path: `PROVISIONING --(>10min stuck)--> PROVISION_FAILED [ORPHAN_RECONCILIATION]`. Refresh troubleshooting matrix with EC2-specific symptoms (INSUFFICIENT_CAPACITY → bump ASG max; IMAGE_PULL_FAILED → re-push ECR image; CADDY_ROUTE_ADD_FAILED → check Caddy service health; etc.).
- [ ] `10-3-byo-vs-managed-refresh`: In `docs/instance-byo-vs-managed.md`, replace any mention of Fly with EC2 as the managed backend. Otherwise minor touch-up only.

### Section 11 — Verification

- [ ] `11-1-api-typecheck` / `11-2-api-test` / `11-3-web-typecheck` / `11-4-web-test` / `11-5-infra-synth` / `11-6-monorepo-typecheck-test` / `11-7-openspec-validate`: see Testing Plan above.
- [ ] `op-11-8-manual-smoke`: OPERATOR — full smoke test (deploy + 1 provision → HEALTHY <90s + URL hit + deprovision verify-all-removed + force-fail IMAGE_PULL_FAILED + Retry success + orphan scenario verify cron tears down).
- [ ] `11-9-byo-doc-refresh`: Final read-through of `docs/instance-byo-vs-managed.md` to verify no stale facts.

### Section 12 — Post-merge cutover (OPERATOR-ONLY)

- [ ] `op-12-1-prod-cdk-deploy`: OPERATOR.
- [ ] `op-12-2-flip-instance-provisioner`: OPERATOR.
- [ ] `op-12-3-customer-announce`: OPERATOR.
- [ ] `op-12-4-monitor-24h`: OPERATOR.

## Delegation Notes

Coder agents are flagged as Coder A..F. Operator tasks (`op-*` ids) are NOT assigned to any coder — orchestrator surfaces them to the user. File allowlists are strict; no file appears in two coder slices within the same batch.

### Batch 1 — Independent foundation work (PARALLEL, 6 coders)

- [ ] Coder A — `2-1-infra-workspace`, `2-2-infra-deps-tooling` → files: `packages/infra/package.json` (new), `packages/infra/cdk.json` (new), `packages/infra/tsconfig.json` (new), `packages/infra/bin/cdk.ts` (skeleton only — empty App with TODO comments). No other coder writes to `packages/infra/` in this batch.
- [ ] Coder B — `3-1-api-aws-deps`, `3-2-pnpm-install-baseline` → files: `packages/api/package.json`, `pnpm-lock.yaml`. (Coder B must run install + typecheck baseline after editing.)
- [ ] Coder C — `6-1-ui-poll-cap-120s` → files: `apps/web/components/instances/provision-instance-dialog.tsx` (only the two-literal change).
- [ ] Coder D — `8-1-env-example-rewrite` → files: `apps/web/.env.example`.
- [ ] Coder E — `10-1-ec2-setup-doc` (can start with research docs as input even before AWS code exists) → files: `docs/ec2-container-provisioner-setup.md` (new).
- [ ] Coder F — START on `2-3-network-stack` (depends only on Coder A's package skeleton being merged first; sequence A→F serially or run F second in the batch) → files: `packages/infra/lib/network-stack.ts` (new).

Conflicts: none across A–E. F waits for A's PR.

### Batch 2 — CDK stacks (PARALLEL, 4 coders after A+F merged)

- [ ] Coder G — `2-4-ecs-stack` → files: `packages/infra/lib/ecs-stack.ts` (new).
- [ ] Coder H — `2-5-dns-stack` → files: `packages/infra/lib/dns-stack.ts` (new).
- [ ] Coder I — `2-6-ingress-stack` → files: `packages/infra/lib/ingress-stack.ts` (new). DEPENDS on H (cert/zone refs) — sequence H before I.
- [ ] Coder J — `2-7-monitoring-stack` → files: `packages/infra/lib/monitoring-stack.ts` (new). DEPENDS on G + I (cluster + alb refs) — sequence G+I before J.

### Batch 3 — CDK wiring + CI (1 coder after Batch 2)

- [ ] Coder K — `2-8-bin-wiring-ssm`, `2-9-ci-synth-smoke` → files: `packages/infra/bin/cdk.ts` (fill in stack refs + SSM params), CI workflow file (search for `.github/workflows/*.yml` or equivalent; add synth step). DEPENDS on G+H+I+J.

### Batch 4 — Provisioner module TDD (1 coder, SERIAL within slice)

- [ ] Coder L — `4-1-provisioner-tests-first` → `4-2-tests-red` → `4-3-impl-ec2-provisioner` → `4-4-factory-rewrite-remove-fly` → `4-5-tests-green` → `4-6-api-typecheck-green` → files: `packages/api/src/lib/instance-provisioner.ts`, `packages/api/src/lib/__tests__/instance-provisioner.test.ts`. DEPENDS on Batch 1 Coder B (AWS deps installed).

### Batch 5 — Provision-task SLA + audit metadata (1 coder after Batch 4)

- [ ] Coder M — `5-1-provision-task-sla`, `9-1-audit-provision-metadata`, `9-2-audit-provision-failed-metadata`, `9-3-audit-deprovision-metadata` → files: `packages/api/src/lib/provision-task.ts`, `packages/api/src/routers/instance.ts`. DEPENDS on Coder L (provisioner contract stable).

### Batch 6 — Orphan reconciliation cron TDD (1 coder, parallel with Batch 5)

- [ ] Coder N — `7-1-orphan-cron-tests-first` → `7-2-orphan-cron-impl` → `7-3-orphan-cron-instrumentation` → `7-4-orphan-tests-green` → `9-4-audit-orphan-cleanup-action` (verify part) → files: `apps/web/lib/cron/cleanup-failed-provisions.ts`, `apps/web/lib/cron/__tests__/orphan-reconciliation.test.ts` (new), `apps/web/instrumentation.ts`. DEPENDS on Coder L (uses `getProvisioner().backend === 'ec2'` guard + `provisioner.deprovision()`).

### Batch 7 — Remaining docs + verification (PARALLEL, 2 coders)

- [ ] Coder O — `10-2-instance-provisioning-rewrite`, `10-3-byo-vs-managed-refresh`, `11-9-byo-doc-refresh` → files: `docs/instance-provisioning.md`, `docs/instance-byo-vs-managed.md`.
- [ ] Coder P — `11-1` → `11-7` verification (typecheck/test/synth/openspec validate) → no file writes; just runs the commands and reports.

### Operator-only follow-ups (NOT assigned to coders)

- [ ] User actions: `op-1-1-aws-profile`, `op-1-2-cdk-bootstrap`, `op-1-3-dns-delegation`, `op-1-4-ecr-push`, `op-2-10-cdk-deploy`, `op-11-8-manual-smoke`, `op-12-1-prod-cdk-deploy`, `op-12-2-flip-instance-provisioner`, `op-12-3-customer-announce`, `op-12-4-monitor-24h`. Orchestrator must surface these to the user with the relevant context (commands, environment, expected outputs).

### Dependencies (summary)

- Batch 1 fans out from 0 deps. Coder F (network-stack) needs Coder A's package skeleton first.
- Batch 2 depends on Batch 1 (CDK package + network).
- Batch 3 depends on Batch 2.
- Batch 4 (provisioner) depends on Batch 1 Coder B (deps installed).
- Batch 5 (provision-task/audit) depends on Batch 4 Coder L.
- Batch 6 (orphan cron) depends on Batch 4 Coder L (parallel with Batch 5; different files).
- Batch 7 docs+verify last.

### Risk Areas

- **Singleton cache in `getProvisioner()`**: tests rely on `vi.resetModules()` to reset; Coder L must verify the fresh-import pattern still works after adding the EC2 branch.
- **Audit metadata schema**: metadata column is JSON; no DB migration. But downstream consumers (audit-log UI) may filter on known keys — verify the dashboard's audit-log component is tolerant of unknown metadata keys (likely yes, but Coder M should grep for any explicit metadata-shape constraints in `apps/web`).
- **Cloud Map Service ID vs Namespace ID**: AWS SDK research §7 flags that `RegisterInstance` needs the SERVICE id not the namespace id. Coder I (ingress-stack) must create both the namespace AND a Service inside it, and the SSM param `/controlai/infra/CLOUD_MAP_SERVICE_ID` must be the service id. Coder L's `Ec2ContainerProvisioner` reads that env var (rename `CLOUD_MAP_NAMESPACE_ID` env from spec text to `CLOUD_MAP_SERVICE_ID` in the constructor — keep `CLOUD_MAP_NAMESPACE_ID` also if needed for tagging).
- **EC2 IP resolution**: bridge-mode tasks bind to host port + host IP. Coder L must call `DescribeContainerInstances` → `DescribeInstances` to translate `containerInstanceArn` → ec2 private IP for the Cloud Map SRV record. Don't forget the new `@aws-sdk/client-ec2` dep (Coder B should include it pre-emptively per task 3-1 note).
- **EC2 cleanup on partial failure**: spec scenario 4.1.3 requires that if CreateService fails after CreateSecret succeeded, the secret must be deleted. Coder L must implement try/catch with explicit cleanup-on-fail in `provision()`.
- **Caddy admin endpoint reachability in tests**: tests should `vi.stubGlobal('fetch', ...)` and NOT depend on actual network calls. Same for the daemon `/v1/health` check.
- **`Promise.race` SLA + timer cleanup**: Coder M's 90s timer must `clearTimeout` on resolve to avoid hanging the process in tests.
- **Strict openspec validate**: task 11-7 may flag any drift between the new audit-action string and what's documented. Verify the spec's "Add new audit action `instance.orphanCleanup`" actually requires a spec-deltas update — it currently lives only in the design doc + tasks.md; Coder P should NOT amend the openspec change in this plan (that is mad-agent's domain). If validate flags it, escalate to user.

## Done Criteria

- [ ] All `todos` in frontmatter with non-`op-` ids are `status: done` and matching body checklists are `[x]`.
- [ ] All `op-*` ids are surfaced to the user with context (they remain `status: pending` until the user runs them and reports back).
- [ ] Testing Plan complete: every non-op verification command GREEN (11-1 through 11-7, plus 11-9 doc read-through).
- [ ] OpenSpec tasks (tasks.md): every numbered checkbox EXCEPT 1.x, 2.10, 11.8, 12.x is `[x]` (those four sections are operator-only).
- [ ] `pnpm openspec validate add-ec2-container-provisioner --strict` returns success.
- [ ] No `FlyProvisioner`, no `FLY_*` env-var reads, and no `INSTANCE_PROVISIONER=fly` codepath remain anywhere in `packages/api/src/`, `apps/web/`, or `docs/` (verified by grep).
- [ ] `Ec2ContainerProvisioner.backend === 'ec2'` and factory selection works per spec deltas (covered by tests 4.1.10–4.1.13).
- [ ] `packages/infra/` synthesizes cleanly via `pnpm --filter @controlai-web/infra synth` with no AWS credentials.

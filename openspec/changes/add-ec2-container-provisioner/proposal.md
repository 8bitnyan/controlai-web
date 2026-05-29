# Change: Real EC2-backed daemon provisioner (`Ec2ContainerProvisioner`)

## Why

The parent change `add-instance-auto-provisioning` (archived 2026-05-28) shipped the contract layer — DB schema, tRPC procedures, UI, pluggable `InstanceProvisioner` interface, and a `MockProvisioner` — but **explicitly deferred** the real container scheduler to a follow-up spec. Today every managed-tier provision succeeds with synthetic data: a row reaches `HEALTHY` with `version: mock-0.0.0`, but no actual daemon container is running, and the `baseURL` resolves to nothing. Customer onboarding still requires manual ops.

This change implements **`Ec2ContainerProvisioner`** — bin-packed daemon containers on ECS-on-EC2 in `ap-northeast-2`, fronted by a Caddy reverse proxy pool behind a single ALB with a wildcard ACM cert. Per-org subdomains (`{org-slug}-{env}.daemons.controlai.io`) route to the right container via Caddy's dynamic config. Secrets are stored in AWS Secrets Manager. The infrastructure is defined in a new `packages/infra/` CDK workspace.

Out-of-spec `FlyProvisioner` code that was incorrectly added during the parent change's apply is removed in this spec — the archived spec mandated mock-only v1, and v2 picks one real backend (EC2) as the supported path.

## What Changes

### Provisioner & interface (`packages/api/src/lib/instance-provisioner.ts`)

- **ADD** `Ec2ContainerProvisioner` class implementing `InstanceProvisioner`. Constructor reads AWS config from env; `provision()` registers an ECS task definition revision, creates a service, polls until task `RUNNING`, fetches the assigned host IP+port via `describeTasks`, calls Caddy admin API to add a route, returns `{ bearerToken, baseURL, ready, provisionerInstanceId: taskArn }`.
- **REMOVE** `FlyProvisioner` class and all `FLY_*` env vars. The parent spec's design.md §28 explicitly listed Fly as a non-shipping alternative; the implementation was an apply-time mistake.
- **MODIFY** `getProvisioner()` factory: branches on `INSTANCE_PROVISIONER` env var → `mock` | `ec2`. Anything else throws at startup with a clear message naming the value received.
- **ADD** structured AWS error mapping: `INSUFFICIENT_CAPACITY`, `IMAGE_PULL_FAILED`, `SECRET_NOT_FOUND`, `TASK_FAILED_TO_START`, `CADDY_ROUTE_ADD_FAILED`, `MACHINE_START_TIMEOUT` (reused). Each surfaces in the dialog progress log.

### Background task & SLA (`packages/api/src/lib/provision-task.ts`)

- **MODIFY** total provision SLA budget to **90s** (60s ECS task → RUNNING + 30s daemon health check).
- **MODIFY** UI poll cap in `provision-instance-dialog.tsx` to **120s** (matches new server SLA with margin).
- Live health-check still skipped for `mock` backend; **enabled** for `ec2`.

### Reconciliation cron (`apps/web/lib/cron/cleanup-failed-provisions.ts`)

- **ADD** hourly orphan-detection pass: list ECS tasks with tag `controlai-org-id`; for any task with no matching `ControlaiInstance` DB row, deregister; for any DB row stuck in `PROVISIONING` > 10 min with no live task, mark `PROVISION_FAILED`. The existing 24h failed-row cleanup stays unchanged.

### Audit log enrichment

- **MODIFY** `instance.provision`, `instance.provisionFailed`, `instance.deprovision` metadata to include `{ provisionerBackend, awsRegion, taskArn?, secretArn?, hostInstanceId? }`. No new audit actions.

### Infrastructure (`packages/infra/` — new workspace)

- **ADD** `packages/infra/` CDK app (TypeScript). Stacks:
  - **NetworkStack** — new VPC for daemons: 2 private subnets, 2 public subnets, 1 NAT gateway in az-a, VPC endpoints for ECR / Secrets Manager / CloudWatch Logs / S3.
  - **EcsStack** — ECS cluster `controlai-daemons`, EC2 capacity provider, ASG (min=1, max=10, t3.medium), bridge-mode task family `controlai-daemon` (multiple revisions, one per managed instance), shared task role, shared security group, shared task execution role with Secrets Manager `GetSecretValue` scoped to `arn:aws:secretsmanager:*:*:secret:controlai/daemon/*`.
  - **DnsStack** — Route53 hosted zone `daemons.controlai.io`, wildcard ACM cert `*.daemons.controlai.io`, ALB alias record.
  - **IngressStack** — ALB with HTTPS listener, Caddy ECS Fargate service (2 replicas, dedicated target group), Cloud Map private namespace `daemons.local` for daemon SRV records.
  - **MonitoringStack** — minimal alarms: cluster CPU, cluster memory, ALB 5xx rate, ECS service events log group. SNS topic `controlai-daemons-alerts`.
- **ADD** `packages/infra/bin/cdk.ts` entry + `cdk.json` + `tsconfig.json` + per-stack files under `packages/infra/lib/`.
- **ADD** CDK output exports (cluster name, service security group ID, log group name, Caddy admin endpoint, Secrets Manager KMS key ARN) consumed by controlai-web via env vars or SSM Parameter Store.

### IAM for controlai-web

- **ADD** documented IAM policy JSON for the controlai-web task role (least privilege): `ecs:RegisterTaskDefinition`, `ecs:CreateService`, `ecs:UpdateService`, `ecs:DeleteService`, `ecs:DescribeTasks`, `ecs:DescribeServices`, `ecs:ListTasks` (scoped to cluster ARN); `iam:PassRole` (scoped to daemon task role + execution role); `secretsmanager:CreateSecret`, `secretsmanager:DeleteSecret`, `secretsmanager:DescribeSecret`, `secretsmanager:UpdateSecret`, `secretsmanager:TagResource` (scoped to `controlai/daemon/*`); `logs:DescribeLogGroups`, `logs:DescribeLogStreams`, `logs:GetLogEvents` (scoped to `/aws/ecs/controlai-daemons`); `elasticloadbalancingv2:DescribeTargetHealth` (read-only). Stack output references in design.md.

### Env vars

- **ADD** to `apps/web/.env.example`:
  - `AWS_REGION=ap-northeast-2`
  - `AWS_ACCOUNT_ID=<numeric>`
  - `ECS_CLUSTER_NAME=controlai-daemons`
  - `ECS_TASK_FAMILY=controlai-daemon`
  - `ECS_TASK_ROLE_ARN=...`
  - `ECS_EXECUTION_ROLE_ARN=...`
  - `ECS_SECURITY_GROUP_ID=...`
  - `ECS_SUBNETS=subnet-...,subnet-...` (private subnets, comma-separated)
  - `CADDY_ADMIN_ENDPOINT=http://caddy.daemons.local:2019` (internal Cloud Map name)
  - `SECRETS_KMS_KEY_ARN=...`
  - `DAEMON_LOG_GROUP=/aws/ecs/controlai-daemons`
- **MODIFY** `DAEMON_IMAGE` example to ECR: `<account>.dkr.ecr.ap-northeast-2.amazonaws.com/controlai-daemon:stable`.
- **REMOVE** all `FLY_*` env vars.

### Docs

- **ADD** `docs/ec2-container-provisioner-setup.md` — one-time AWS account prep, CDK bootstrap, deploy steps, troubleshooting matrix, cost expectations.
- **MODIFY** `docs/instance-provisioning.md` — replace the Fly section with EC2; update prerequisites + env var table + state machine diagram (add the orphan-cron path).

### Migration / rollout

- Existing `mock` rows in production DB stay untouched. When operator flips `INSTANCE_PROVISIONER=mock → ec2`, new provisions use EC2; old mock rows must be manually deprovisioned (cleanup cron eventually sweeps any failed mocks).
- No schema migration. The existing `provisionerInstanceId TEXT?` column stores the ECS task ARN.

## Impact

- **Affected specs (existing):** `instance-management` — modifies Requirement "Pluggable provisioner backend" (removes "v1 only accepts mock" language, adds `ec2` as supported, restates fail-fast for unknown values); adds Requirement "EC2 container provisioner backend" with detailed scenarios.
- **Affected code:**
  - `packages/api/src/lib/instance-provisioner.ts` — add `Ec2ContainerProvisioner`, remove `FlyProvisioner`, update factory.
  - `packages/api/src/lib/__tests__/instance-provisioner.test.ts` — replace Fly tests with EC2 tests using `aws-sdk-client-mock`.
  - `packages/api/src/lib/provision-task.ts` — bump SLA timeout to 90s; enable health check for EC2 backend.
  - `apps/web/components/instances/provision-instance-dialog.tsx` — UI poll cap → 120s.
  - `apps/web/lib/cron/cleanup-failed-provisions.ts` — add hourly orphan-detection pass.
  - `apps/web/instrumentation.ts` — schedule the new pass.
  - `apps/web/.env.example` — AWS vars in, FLY vars out.
  - `packages/api/package.json` — add `@aws-sdk/client-ecs`, `@aws-sdk/client-secrets-manager`, `aws-sdk-client-mock` (dev).
  - `packages/infra/` — entire new workspace (CDK app, ~600–900 LOC across stacks).
  - `docs/ec2-container-provisioner-setup.md` — new.
  - `docs/instance-provisioning.md` — significant rewrite.
  - `docs/instance-byo-vs-managed.md` — minor refresh.
- **New env vars:** see "Env vars" above.
- **Removed env vars:** `FLY_API_TOKEN`, `FLY_ORG_SLUG`, `FLY_APP_NAME_PREFIX`, `FLY_REGION`.
- **AWS cost (steady state):**
  - Empty cluster baseline: 1× t3.medium (~$30/mo) + ALB (~$22/mo) + 1× NAT gateway (~$32/mo) + Route53 zone (~$0.50/mo) + 2× Caddy Fargate replicas (~$15/mo) ≈ **~$100/mo idle**.
  - At 100 daemons: ~$0.60 × 100 + baseline + Secrets Manager (100 × $0.40 = $40) ≈ **~$200/mo**.
  - At 1000 daemons: ~$0.60 × 1000 + baseline + Secrets Manager ($400) ≈ **~$1100/mo** (~$1.10/daemon).
  - Secrets Manager is the dominant scaling cost; documented but accepted per user decision.
- **Security:** plaintext bearer tokens still never persist; token written to Secrets Manager via `CreateSecret` (encrypted at rest via dedicated KMS key), referenced from task definition via `valueFrom: arn:.../secret/controlai/daemon/<instanceId>/token`. DB `bearerTokenEnc` still holds the encrypted copy for dashboard-side daemon-API calls.
- **Blast radius:** controlai-web's IAM role can only mutate ECS resources tagged `controlai:cluster=controlai-daemons` and Secrets Manager secrets under `controlai/daemon/*`. Shared daemon task role has zero AWS API surface (egress-only).
- **NON-GOALS:** Region geo-routing (still single-region in `ap-northeast-2`). Token rotation. Multi-account isolation. Per-daemon IAM role. Per-daemon CloudWatch alarms. Fargate fallback for overflow. Customer-BYO custom domain.

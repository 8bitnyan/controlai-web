# Tasks: Ec2ContainerProvisioner

## 1. AWS account prep & ECR (operator manual)

- [ ] 1.1 Confirm AWS account ID; configure CLI profile `controlai` with credentials.
- [ ] 1.2 `cdk bootstrap aws://<account>/ap-northeast-2` (one-time).
- [ ] 1.3 Delegate DNS for `daemons.controlai.io` from parent zone to the Route53 zone CDK will create (extract NS records after first `cdk deploy DnsStack`).
- [ ] 1.4 Push daemon image to ECR repo `controlai-daemon` (CDK creates the repo in EcsStack). One-time push for first deploy; recurring on daemon release.

## 2. CDK infrastructure (`packages/infra/`)

- [x] 2.1 Create `packages/infra/` workspace package; add to `pnpm-workspace.yaml`.
- [x] 2.2 Add deps: `aws-cdk-lib@2`, `constructs@10`, `aws-cdk@2` (devDep). Add `cdk.json`, `tsconfig.json`, `bin/cdk.ts`, `package.json` scripts (`deploy`, `diff`, `synth`).
- [x] 2.3 Implement `lib/network-stack.ts`: VPC 10.20.0.0/16, 2 AZs, 2 private + 2 public subnets, 1 NAT gateway (az-a), VPC endpoints (ECR API + ECR Docker + Secrets Manager + CloudWatch Logs + S3 gateway).
- [x] 2.4 Implement `lib/ecs-stack.ts`: ECS cluster `controlai-daemons`; EC2 capacity provider with ASG (min=1, max=10, t3.medium, ECS-optimized AMI); IAM `controlai-daemon-task-role` (empty policy) and `controlai-daemon-execution-role` (Secrets Manager + KMS + ECR + Logs scoped policies); shared security group for daemon tasks (egress 443 + 1883/8883 to internet, ingress from Caddy SG only); KMS key for daemon secrets; ECR repository `controlai-daemon` with lifecycle policy (keep last 10 images); CloudWatch Log Group `/aws/ecs/controlai-daemons` (30-day retention).
- [x] 2.5 Implement `lib/dns-stack.ts`: Route53 hosted zone `daemons.controlai.io`; wildcard ACM cert `*.daemons.controlai.io` with DNS validation.
- [x] 2.6 Implement `lib/ingress-stack.ts`: ALB (internet-facing, HTTPS:443 listener with wildcard cert, HTTP:80 listener redirecting to HTTPS); Caddy Fargate service (2 replicas, custom Caddy image with admin API enabled, registered to a dedicated target group); ALB default-action forwards to Caddy TG; ALB alias A-record `*.daemons.controlai.io` → ALB DNS in Route53; Cloud Map private namespace `daemons.local` in the VPC.
- [x] 2.7 Implement `lib/monitoring-stack.ts`: SNS topic `controlai-daemons-alerts`; CloudWatch alarms — cluster CPUUtilization > 80 (5min × 2), cluster MemoryUtilization > 80 (5min × 2), ALB HTTPCode_ELB_5XX_Count > 10 (1min × 5), Caddy service deployment failures (event-based via EventBridge). All alarms publish to SNS.
- [x] 2.8 Wire stacks in `bin/cdk.ts`: env=us via context; cross-stack refs via stack outputs; export key outputs (cluster name, task role ARN, execution role ARN, security group ID, subnet IDs, Caddy admin endpoint, secrets KMS key ARN, log group name) to SSM Parameter Store under `/controlai/infra/*`.
- [x] 2.9 Add `pnpm --filter @controlai-web/infra synth` and `cdk diff` to CI (smoke test, never deploys).
- [ ] 2.10 Operator runs `cdk deploy --all` once; record stack output values in `apps/web/.env.local` (and team password manager for prod).

## 3. AWS SDK dependencies in `packages/api`

- [x] 3.1 Add to `packages/api/package.json`: `@aws-sdk/client-ecs@^3`, `@aws-sdk/client-secrets-manager@^3`, `@aws-sdk/client-service-discovery@^3`, and (devDep) `aws-sdk-client-mock@^4`.
- [x] 3.2 `pnpm install` and ensure no peer-dep warnings.
- [x] 3.3 Run `pnpm -r typecheck` baseline.

## 4. Provisioner module (`packages/api/src/lib/instance-provisioner.ts`)

- [x] 4.1 Write tests FIRST (`packages/api/src/lib/__tests__/instance-provisioner.test.ts`). Scenarios:
  - 4.1.1 `MockProvisioner` — existing 5-stage progress assertion (unchanged).
  - 4.1.2 `Ec2ContainerProvisioner.provision` happy: aws-sdk-client-mock for ECS `RegisterTaskDefinition` → `CreateService` → `DescribeTasks` (returns RUNNING after 2 polls) → `RegisterInstance` (Cloud Map) → fetch mock for Caddy admin API POST → fetch mock for daemon `/v1/health` → returns `{ bearerToken, baseURL, ready: true, provisionerInstanceId: <taskArn> }`. Asserts onProgress sequence: `creating_secret` 5%, `registering_taskdef` 15%, `creating_service` 25%, `waiting_for_task` 40–75%, `registering_dns` 80%, `configuring_caddy` 85%, then provision-task takes over from 95%.
  - 4.1.3 ECS service create returns `INSUFFICIENT_CAPACITY` (CapacityProviderException) → throws `ProvisionerError('INSUFFICIENT_CAPACITY', ...)`.
  - 4.1.4 ECS task pull failure (DescribeTasks shows stoppedReason containing `CannotPullContainerError`) → throws `ProvisionerError('IMAGE_PULL_FAILED', ...)`.
  - 4.1.5 DescribeTasks never reaches RUNNING in 60 s → throws `ProvisionerError('TASK_FAILED_TO_START', ...)` (uses fake timers).
  - 4.1.6 Caddy admin API POST returns 500 → throws `ProvisionerError('CADDY_ROUTE_ADD_FAILED', ...)`.
  - 4.1.7 SecretsManager `CreateSecret` returns `ResourceExistsException` → idempotent: update secret value via `UpdateSecret`, continue.
  - 4.1.8 `Ec2ContainerProvisioner.deprovision`: aws-sdk-client-mock — Caddy DELETE route → ECS UpdateService (desired=0) → DeleteService(force=true) → CloudMap DeregisterInstance → SecretsManager DeleteSecret(forceDeleteWithoutRecovery=true). Asserts every API called exactly once.
  - 4.1.9 Deprovision tolerates Caddy 404 and SecretsManager ResourceNotFoundException (idempotent).
  - 4.1.10 Factory `getProvisioner()` with `INSTANCE_PROVISIONER='ec2'` returns Ec2ContainerProvisioner (asserts via `.backend === 'ec2'`).
  - 4.1.11 Factory with `INSTANCE_PROVISIONER='ec2'` and missing `AWS_REGION` / `ECS_CLUSTER_NAME` / `ECS_TASK_ROLE_ARN` throws clear startup error naming the missing var(s).
  - 4.1.12 Factory with `INSTANCE_PROVISIONER='fly'` throws `Error("INSTANCE_PROVISIONER=fly is no longer supported; the FlyProvisioner was removed in add-ec2-container-provisioner. Use 'mock' or 'ec2'.")`.
  - 4.1.13 Factory with `INSTANCE_PROVISIONER='unknown'` throws clear error listing supported values.
  - 4.1.14 Remove all existing FlyProvisioner test cases.
- [x] 4.2 Confirm tests RED (`pnpm --filter @controlai-web/api test -- instance-provisioner`).
- [x] 4.3 Implement `Ec2ContainerProvisioner` class:
  - 4.3.1 Constructor reads env: `AWS_REGION`, `AWS_ACCOUNT_ID`, `ECS_CLUSTER_NAME`, `ECS_TASK_FAMILY`, `ECS_TASK_ROLE_ARN`, `ECS_EXECUTION_ROLE_ARN`, `ECS_SECURITY_GROUP_ID`, `ECS_SUBNETS` (split csv), `CADDY_ADMIN_ENDPOINT`, `SECRETS_KMS_KEY_ARN`, `DAEMON_IMAGE`, `DAEMON_BASE_DOMAIN`, `DAEMON_LOG_GROUP`, optional `CLOUD_MAP_NAMESPACE_ID`. Throws at construction if any required var missing.
  - 4.3.2 Lazy-init SDK clients (`ECSClient`, `SecretsManagerClient`, `ServiceDiscoveryClient`).
  - 4.3.3 `provision()` per design flow (creates secret → registers task def → creates service → polls → registers SRV → updates Caddy via fetch). Emit onProgress at each stage with the documented percent values.
  - 4.3.4 `deprovision()` per design flow (Caddy DELETE → ECS DeleteService → CloudMap deregister → Secrets DeleteSecret).
  - 4.3.5 Helper `mapAwsError(err): ProvisionerError` — switch on `err.name` to map known AWS error names to ProvisionerError codes.
  - 4.3.6 All AWS calls tagged with `controlai:cluster=controlai-daemons`, `controlai:org-id=<orgId>`, `controlai:env=<env>`, `controlai:instance-id=<instanceId>` for the orphan-detection cron.
- [x] 4.4 Update `getProvisioner()` factory:
  - 4.4.1 Switch on `INSTANCE_PROVISIONER`: `'ec2'` → new `Ec2ContainerProvisioner()`; `'mock'` or unset → `MockProvisioner`; anything else (including `'fly'`) → throw with the listed error messages.
  - 4.4.2 Delete `FlyProvisioner` class (~90 LOC) and all `FLY_*` env reads.
  - 4.4.3 Cache singleton like before; ensure `vi.resetModules()` in tests gives a fresh instance.
- [x] 4.5 Re-run tests, confirm GREEN.
- [x] 4.6 `pnpm --filter @controlai-web/api typecheck` GREEN.

## 5. Background task SLA bump (`packages/api/src/lib/provision-task.ts`)

- [x] 5.1 Change post-provisioner timeout from current implicit 30 s to documented 30 s for health check (no change), but increase total task budget guard to 90 s.
- [x] 5.2 Keep mock branch (no live health check) untouched.
- [x] 5.3 Add `console.error` logging (already added in previous slice) for failures; verify cause field includes raw AWS error.

## 6. UI poll cap (`apps/web/components/instances/provision-instance-dialog.tsx`)

- [x] 6.1 Change `60_000` ms poll cap to `120_000`.
- [x] 6.2 Update timeout message: "Provisioning is taking longer than expected (>2 min). Check the AWS console for ECS task status, or wait and refresh."
- [x] 6.3 No other UI changes needed — progress block already handles new stage names.

## 7. Orphan reconciliation cron (`apps/web/lib/cron/cleanup-failed-provisions.ts`)

- [x] 7.1 Write tests FIRST in `apps/web/lib/cron/__tests__/orphan-reconciliation.test.ts`:
  - 7.1.1 Returns 0 deletions when ECS task list matches DB rows exactly.
  - 7.1.2 ECS task tagged `controlai-instance-id=abc` exists but no DB row → stops task + deregisters task def + deletes secret + writes `instance.orphanCleanup` audit.
  - 7.1.3 DB row stuck `PROVISIONING` > 10 min with no ECS task → marks `PROVISION_FAILED` with progress-log entry `[ORPHAN_RECONCILIATION] Provisioning timed out`.
  - 7.1.4 Mock provisioner branch: orphan reconciliation no-ops (only runs when backend is `ec2`).
  - 7.1.5 Swallows AWS API errors gracefully (returns partial-count result).
- [x] 7.2 Implement `reconcileOrphans(prisma, now)` function in the same file. Pulls ECS tasks via `ListTasks(cluster, tag-filter)` then `DescribeTasks`; cross-references with DB.
- [x] 7.3 Wire into `instrumentation.ts`: add second `setInterval(reconcileOrphans, 60 * 60 * 1000)` alongside existing cleanup tick. Same single-shot symbol guard.
- [x] 7.4 Tests GREEN.

## 8. Env-var bootstrap

- [x] 8.1 Update `apps/web/.env.example`: replace FLY_* block with AWS block (per proposal.md "Env vars" section). Keep `DAEMON_BASE_DOMAIN`, `NEXT_PUBLIC_DAEMON_BASE_DOMAIN`, `INSTANCE_PROVISIONER` (now `mock` | `ec2`).
- [x] 8.2 Update `apps/web/.env.example` `DAEMON_IMAGE` comment to point to ECR.
- [x] 8.3 No `.env.local` changes in CI — those are operator-managed.

## 9. Audit-log metadata

- [x] 9.1 In `provision-task.ts`, extend `instance.provision` audit metadata `{ env, baseURL, provisionerBackend, awsRegion, taskArn, secretArn }`. Only include the AWS fields when backend is `ec2`.
- [x] 9.2 Extend `instance.provisionFailed` metadata `{ env, error: { code, message }, provisionerBackend, awsRegion?, taskArn? }`.
- [x] 9.3 Extend `instance.deprovision` (in `instance.ts` router) metadata `{ provisionerBackend, env, awsRegion?, taskArn? }`.
- [x] 9.4 Add new audit action `instance.orphanCleanup` with metadata `{ taskArn, secretArn, reason: 'no-db-row' | 'stuck-provisioning' }`.

## 10. Docs

- [x] 10.1 Write `docs/ec2-container-provisioner-setup.md`: AWS account prep, CDK bootstrap commands, deploy order, env-var mapping, DNS delegation, ECR push instructions, smoke test, rollback. Include mermaid flow diagram from design.md.
- [x] 10.2 Rewrite `docs/instance-provisioning.md` Fly section → EC2 section. Update env-var table, state-machine diagram (add orphan-cron path), troubleshooting matrix.
- [x] 10.3 Minor refresh of `docs/instance-byo-vs-managed.md` to mention EC2 as the managed backend.

## 11. Verification

- [x] 11.1 `pnpm --filter @controlai-web/api typecheck` GREEN.
- [x] 11.2 `pnpm --filter @controlai-web/api test` GREEN (all 200+ tests, including new EC2 provisioner cases).
- [x] 11.3 `pnpm --filter ./apps/web typecheck` GREEN.
- [x] 11.4 `pnpm --filter ./apps/web test` GREEN.
- [x] 11.5 `pnpm --filter @controlai-web/infra synth` GREEN (no CDK errors).
- [x] 11.6 `pnpm -r typecheck && pnpm -r test` GREEN across monorepo.
- [x] 11.7 `pnpm openspec validate add-ec2-container-provisioner --strict` GREEN.
- [ ] 11.8 **Manual smoke test in AWS sandbox** (operator, blocking for production cutover):
  - Deploy CDK stacks.
  - Push daemon image to ECR.
  - Set `INSTANCE_PROVISIONER=ec2` in apps/web/.env.local + restart dev server.
  - Provision one test daemon → dialog shows progress 0→100% → row reaches HEALTHY in <90 s.
  - Hit the daemon URL `https://<slug>-prod.daemons.controlai.io/v1/health` → 200.
  - Click Deprovision → all AWS resources removed (verify via `aws ecs list-services`, `aws secretsmanager list-secrets`, `aws servicediscovery list-instances`).
  - Force-fail scenario: provision with intentionally bad DAEMON_IMAGE → row reaches PROVISION_FAILED with `IMAGE_PULL_FAILED` in dialog log → click Retry after fixing → success.
  - Orphan scenario: provision normally, manually delete DB row → hourly cron detects orphan and tears down AWS task within 1 h.
- [x] 11.9 Update parent doc `docs/instance-byo-vs-managed.md` if any comparison facts change.

## 12. Post-merge cutover (operator)

- [ ] 12.1 Production CDK deploy in real AWS account.
- [ ] 12.2 Flip production `INSTANCE_PROVISIONER=ec2`.
- [ ] 12.3 Announce to customers that mock instances must be re-provisioned. Provide migration guide link.
- [ ] 12.4 Monitor for 24 h via CloudWatch dashboard + audit-log review.

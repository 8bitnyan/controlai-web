## MODIFIED Requirements

### Requirement: Pluggable provisioner backend

The system SHALL define an `InstanceProvisioner` interface with `provision()` and `deprovision()` methods, and SHALL select the active implementation via the `INSTANCE_PROVISIONER` environment variable. This change adds `ec2` as the first real-backend implementation. Supported values: `mock` (synthetic, no network — for tests and local dev) and `ec2` (bin-packed ECS-on-EC2 in `ap-northeast-2`). Any other value SHALL throw at startup with a clear message listing the supported values.

#### Scenario: Mock backend selected by default

- **WHEN** `INSTANCE_PROVISIONER` is unset or equals `mock`
- **THEN** `getProvisioner()` returns the `MockProvisioner` instance
- **AND** `provision()` returns a synthetic bearer token, a derived `baseURL`, `ready: true`, and a `provisionerInstanceId` prefixed `mock-`, without any network call

#### Scenario: EC2 backend selected

- **WHEN** `INSTANCE_PROVISIONER=ec2` and all required env vars are present (`AWS_REGION`, `AWS_ACCOUNT_ID`, `ECS_CLUSTER_NAME`, `ECS_TASK_FAMILY`, `ECS_TASK_ROLE_ARN`, `ECS_EXECUTION_ROLE_ARN`, `ECS_SECURITY_GROUP_ID`, `ECS_SUBNETS`, `CADDY_ADMIN_ENDPOINT`, `SECRETS_KMS_KEY_ARN`, `DAEMON_IMAGE`, `DAEMON_BASE_DOMAIN`)
- **THEN** `getProvisioner()` returns the `Ec2ContainerProvisioner` instance with `backend === 'ec2'`
- **AND** subsequent `provision()` calls actually create AWS resources

#### Scenario: EC2 backend selected with missing env vars

- **WHEN** `INSTANCE_PROVISIONER=ec2` and any required env var is absent
- **THEN** `getProvisioner()` throws a startup error naming the missing variable(s)
- **AND** the process refuses to start

#### Scenario: Unknown backend rejected at startup

- **WHEN** `INSTANCE_PROVISIONER` is set to any value other than `mock` or `ec2` (e.g. `k8s`, `nomad`, `gcp`)
- **THEN** `getProvisioner()` throws at startup with a message naming the value received and listing the supported values
- **AND** the process refuses to start

#### Scenario: Legacy fly value rejected

- **WHEN** `INSTANCE_PROVISIONER=fly` is set (left over from an earlier misconfiguration)
- **THEN** `getProvisioner()` throws with a clear message: "INSTANCE_PROVISIONER=fly is no longer supported; the FlyProvisioner was removed in add-ec2-container-provisioner. Use 'mock' or 'ec2'."

#### Scenario: Interface stability across implementations

- **WHEN** a future implementation replaces or extends the EC2 backend
- **THEN** the procedure layer (`instance.provision`, `instance.retryProvision`, `instance.deprovision`) SHALL NOT require any changes
- **AND** the `provisionerInstanceId` column SHALL accept any opaque string the new backend produces

## ADDED Requirements

### Requirement: EC2 container provisioner backend

The system SHALL implement an `Ec2ContainerProvisioner` that spawns one ECS-on-EC2 service per managed daemon instance, in a bin-packed cluster, fronted by a Caddy reverse-proxy pool behind a single ALB with a wildcard ACM cert. Bearer tokens are stored in AWS Secrets Manager. Each daemon's bearer token is injected into the container via the `DAEMON_BEARER_TOKEN` env var referenced from the task definition's `secrets` array.

#### Scenario: Successful EC2 provision

- **WHEN** `instance.provision` invokes `Ec2ContainerProvisioner.provision({ orgId, orgSlug, subdomain, env, onProgress })`
- **THEN** the provisioner SHALL, in order:
  1. Generate a 32-byte hex bearer token and store it in Secrets Manager at `arn:aws:secretsmanager:<region>:<acct>:secret:controlai/daemon/<instanceId>/token`.
  2. Register an ECS task definition revision in family `controlai-daemon` with image `<DAEMON_IMAGE>`, memory 256, CPU 256, container port 8080, dynamic host port mapping, `secrets[].DAEMON_BEARER_TOKEN.valueFrom = <Secrets Manager ARN>`, task role and execution role from env config, awslogs driver to `<DAEMON_LOG_GROUP>` with stream prefix `<instanceId>`, and tags `controlai:cluster=controlai-daemons`, `controlai:org-id=<orgId>`, `controlai:env=<env>`, `controlai:instance-id=<instanceId>`.
  3. Create an ECS service with `desiredCount=1`, `launchType=EC2`, `capacityProviderStrategy=[{capacityProvider: 'controlai-daemons-cp', weight: 1}]`, `placementStrategy=binpack(memory)`, the bridge-mode task definition just registered, and the same tags.
  4. Poll `DescribeTasks` until `lastStatus=RUNNING` with budget 60s. Throw `ProvisionerError('TASK_FAILED_TO_START', ...)` on timeout.
  5. Read the assigned host private IP and host port from `task.attachments` / `containers[0].networkBindings`.
  6. Register a Cloud Map SRV instance at `<instanceId>.daemons.local` pointing at host IP + host port.
  7. Call Caddy admin API (`POST <CADDY_ADMIN_ENDPOINT>/config/apps/http/servers/srv0/routes/...`) to add a route mapping `Host: <subdomain>.<DAEMON_BASE_DOMAIN>` → upstream `srv+http://<instanceId>.daemons.local`. Throw `ProvisionerError('CADDY_ROUTE_ADD_FAILED', ...)` on non-2xx.
  8. Return `{ bearerToken, baseURL: 'https://<subdomain>.<DAEMON_BASE_DOMAIN>', ready: true, provisionerInstanceId: <taskArn> }`.
- **AND** `onProgress` SHALL be invoked at each numbered step with monotonically increasing percent values in the range 5..90.

#### Scenario: Insufficient cluster capacity

- **WHEN** ECS `CreateService` or task placement fails because no host in the cluster has free CPU/memory and the capacity provider cannot launch a new host (ASG at max)
- **THEN** the provisioner throws `ProvisionerError('INSUFFICIENT_CAPACITY', ...)` with a message hinting "Increase ECS_ASG_MAX_SIZE or wait for existing tasks to finish."
- **AND** any Secrets Manager secret already created is deleted to keep state clean

#### Scenario: Image pull failure

- **WHEN** the task transitions to `STOPPED` with `stoppedReason` containing `CannotPullContainerError`
- **THEN** the provisioner throws `ProvisionerError('IMAGE_PULL_FAILED', ...)` including the raw stoppedReason in the cause
- **AND** the service + task definition are deregistered to free the slot

#### Scenario: Secrets Manager secret already exists (idempotent retry)

- **WHEN** `CreateSecret` returns `ResourceExistsException` (e.g. a retry after a previous partial provision)
- **THEN** the provisioner calls `UpdateSecret` to overwrite with the freshly generated token
- **AND** continues to the next step without throwing

#### Scenario: Deprovision tears down all AWS resources

- **WHEN** `instance.deprovision` invokes `Ec2ContainerProvisioner.deprovision({ provisionerInstanceId, baseURL })`
- **THEN** the provisioner SHALL, in order:
  1. Call Caddy admin API to remove the route matching the daemon's hostname.
  2. `UpdateService(desiredCount=0)` then `DeleteService(force=true)`.
  3. Cloud Map `DeregisterInstance(<instanceId>.daemons.local)`.
  4. `DeleteSecret(<secret-arn>, forceDeleteWithoutRecovery=true)`.
- **AND** 404 / `ResourceNotFoundException` responses are tolerated (idempotent)
- **AND** any non-404 failure throws `ProvisionerError('DEPROVISION_FAILED', ...)`, which the `instance.deprovision` tRPC procedure surfaces as `INTERNAL_SERVER_ERROR` so the user knows AWS-side may need manual cleanup

#### Scenario: AWS error code mapping

- **WHEN** the AWS SDK throws a known error name (e.g. `ResourceNotFoundException`, `AccessDeniedException`, `CapacityProviderException`)
- **THEN** the provisioner SHALL map it to a structured `ProvisionerError` with a stable `code` value (one of: `INSUFFICIENT_CAPACITY`, `IMAGE_PULL_FAILED`, `SECRET_NOT_FOUND`, `TASK_FAILED_TO_START`, `CADDY_ROUTE_ADD_FAILED`, `MACHINE_START_TIMEOUT`, `PERMISSION_DENIED`, `DEPROVISION_FAILED`, `UNKNOWN`)
- **AND** the original AWS error SHALL be preserved in `ProvisionerError.cause`

### Requirement: Orphan reconciliation cron

The system SHALL run an hourly reconciliation pass that detects and cleans up AWS resources whose corresponding `ControlaiInstance` DB row has been deleted, and detects DB rows stuck in `PROVISIONING` state with no live ECS task.

#### Scenario: ECS task with no DB row

- **WHEN** the cron lists ECS tasks tagged with `controlai-instance-id=<id>` and finds an id with no matching `ControlaiInstance` row
- **THEN** the cron calls `Ec2ContainerProvisioner.deprovision()` on a synthetic args object built from the task's tags + Cloud Map record
- **AND** writes audit `instance.orphanCleanup` with metadata `{ taskArn, reason: 'no-db-row' }`

#### Scenario: DB row stuck PROVISIONING > 10 min with no task

- **WHEN** a `ControlaiInstance` row has `status='PROVISIONING'` and `provisioningStartedAt < NOW() - 10 min` and no ECS task with matching `controlai-instance-id` tag exists in the cluster
- **THEN** the row's `status` is updated to `PROVISION_FAILED`
- **AND** `provisionProgress.log` gets an entry `[ORPHAN_RECONCILIATION] Provisioning timed out — no live ECS task`
- **AND** the existing 24h cleanup cron eventually deletes the row per its existing rules

#### Scenario: Reconciliation no-op when backend is mock

- **WHEN** `INSTANCE_PROVISIONER=mock`
- **THEN** the orphan reconciliation pass returns immediately without making any AWS API calls

#### Scenario: AWS API errors are swallowed gracefully

- **WHEN** any AWS API call in the reconciliation pass throws (e.g. transient `ThrottlingException`)
- **THEN** the cron logs the error to console
- **AND** returns a partial-counts result `{ scanned, deleted, skipped, errors }`
- **AND** the next hourly tick retries from scratch

### Requirement: AWS infrastructure managed by CDK

The system SHALL define all AWS infrastructure for the daemon fleet via an AWS CDK app under `packages/infra/` (TypeScript). The CDK app SHALL be deployable with `pnpm --filter @controlai-web/infra cdk deploy --all` from a freshly cloned repo against an AWS account that has been bootstrapped with `cdk bootstrap`.

#### Scenario: Stacks split for clean diff

- **WHEN** an operator runs `cdk diff` after a code change
- **THEN** CDK SHALL identify changes per stack (NetworkStack, EcsStack, DnsStack, IngressStack, MonitoringStack)
- **AND** operator can deploy stacks individually if desired

#### Scenario: Stack outputs published to SSM

- **WHEN** stacks deploy successfully
- **THEN** key outputs (`ECS_CLUSTER_NAME`, `ECS_TASK_ROLE_ARN`, `ECS_EXECUTION_ROLE_ARN`, `ECS_SECURITY_GROUP_ID`, private subnet IDs csv, `CADDY_ADMIN_ENDPOINT`, `SECRETS_KMS_KEY_ARN`, `DAEMON_LOG_GROUP`) SHALL be written to SSM Parameter Store under `/controlai/infra/*`
- **AND** controlai-web MAY read them at boot via AWS SDK instead of hard-coded env vars

#### Scenario: CI synth smoke test

- **WHEN** a CI pipeline runs `pnpm --filter @controlai-web/infra synth`
- **THEN** the command SHALL complete in under 60 s without errors
- **AND** SHALL never call any AWS API (synth-only)

### Requirement: FlyProvisioner removed

The `FlyProvisioner` class and all `FLY_*` environment variables that were inadvertently introduced during the apply of the parent change SHALL be removed. The parent spec's design.md §28 explicitly listed Fly as a non-shipping alternative; this change reverts that drift.

#### Scenario: FlyProvisioner class is deleted

- **WHEN** the codebase is inspected
- **THEN** `packages/api/src/lib/instance-provisioner.ts` SHALL NOT contain a `FlyProvisioner` class or any reference to `FLY_API_TOKEN`, `FLY_ORG_SLUG`, `FLY_APP_NAME_PREFIX`, `FLY_REGION`

#### Scenario: Documentation no longer mentions Fly as supported

- **WHEN** `docs/instance-provisioning.md` and `docs/instance-byo-vs-managed.md` are read
- **THEN** they SHALL NOT list Fly as a supported backend
- **AND** any historical mention of Fly SHALL be in a "Why not other providers?" rationale section only

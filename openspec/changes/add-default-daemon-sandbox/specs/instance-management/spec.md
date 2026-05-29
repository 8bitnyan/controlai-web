# Instance Management (Deltas for Default Daemon Sandbox)

## ADDED Requirements

### Requirement: Singleton Default Daemon Per Organization

Every `Organization` SHALL have exactly one auto-created `ControlaiInstance` row that points to the configured default daemon. This row is created synchronously during organization creation via a `better-auth` lifecycle hook, and is read-only from the UI. The row maps directly to `Organization.id` as the ownership relationship.

#### Scenario: Org signup auto-creates default daemon row

- **WHEN** a new `Organization` is created via `org.create`
- **THEN** the `better-auth` org.created hook SHALL invoke `instance.bootstrapDefault(orgId)`
- **AND** a new `ControlaiInstance` row SHALL be inserted with `baseURL = DEFAULT_DAEMON_BASE_URL` (from env), `bearerTokenEnc = encryptToken(DEFAULT_DAEMON_BEARER_TOKEN)`, `status = 'HEALTHY'` (or polled on next health check), `env = NULL` (not provisioned)
- **AND** the org creation succeeds even if bootstrap fails (error logged but not surfaced to user)

#### Scenario: Bootstrap is idempotent

- **WHEN** `instance.bootstrapDefault(orgId)` is called on an org that already has a default daemon row
- **THEN** the procedure returns the existing row without inserting a duplicate
- **AND** no audit log is written

#### Scenario: Missing env vars cause graceful failure

- **WHEN** `instance.bootstrapDefault(orgId)` is invoked but `DEFAULT_DAEMON_BASE_URL` or `DEFAULT_DAEMON_BEARER_TOKEN` env var is not set
- **THEN** the procedure throws `Error` with a message naming the missing var(s)
- **AND** the org is marked as requiring manual bootstrap (or bootstrap failure is logged for ops review)

### Requirement: Legacy Instance Soft Archive

Existing `ControlaiInstance` rows (pre-default-daemon era) SHALL be marked `legacy = true` and filtered from default UI listings. This preserves audit history while reducing confusion.

#### Scenario: Legacy rows hidden by default

- **WHEN** a query lists instances for an org via `instance.list({ orgId })`
- **THEN** the result SHALL include only `legacy = false` rows by default
- **AND** a mock instance created before default-daemon deployment SHALL NOT appear in the list

#### Scenario: Admin can include legacy rows

- **WHEN** a procedure is invoked with an explicit flag `includeLegacy: true`
- **THEN** all rows matching the org filter are returned, regardless of `legacy` status

#### Scenario: Backfill migration marks existing rows legacy

- **WHEN** the migration script `backfill-legacy-instances.ts` runs
- **THEN** all existing `ControlaiInstance` rows with `env IS NOT NULL` (provisioned) or `provisioningStartedAt IS NOT NULL` (attempted provision) are set to `legacy = true`
- **AND** rows with neither field set are left `legacy = false` (assumed default daemons from fresh deployments)

### Requirement: Health Pill Replaces Create Instance Button

When a default daemon instance exists for an org, the instances page SHALL hide the "Create instance" button and replace it with a read-only health status pill showing the daemon's current status and last-seen timestamp.

#### Scenario: Button hidden when default daemon exists

- **WHEN** a user views `/orgs/[orgId]/instances` and a `ControlaiInstance` row exists with `legacy = false`
- **THEN** the "Create instance" button SHALL NOT be rendered
- **AND** the page SHALL show a health status pill: "Sandbox daemon: [status] (last seen [time])"

#### Scenario: Health pill reflects current daemon status

- **WHEN** the daemon's status is `'HEALTHY'`
- **THEN** the pill shows a green checkmark and "HEALTHY"
- **WHEN** the daemon's status is `'DEGRADED'` or `'UNREACHABLE'`
- **THEN** the pill shows a warning icon or red status, prompting the user to check the daemon

#### Scenario: Status updates on periodic health check

- **WHEN** a background task polls the default daemon's `/v1/health` endpoint every 5 minutes
- **THEN** the status is updated in the `ControlaiInstance` row
- **AND** the UI reflects the new status within one refresh or SSE push

### Requirement: EC2 Provisioner Remains Deferred

The `add-ec2-container-provisioner` implementation (ECS-based per-org provisioning) SHALL remain on disk but unused. The default provisioner is `mock`; `INSTANCE_PROVISIONER=ec2` is NOT supported in this spec.

#### Scenario: EC2 provisioner code present but unused

- **WHEN** `INSTANCE_PROVISIONER` is unset or equals `mock`
- **THEN** the system uses `MockProvisioner` and all instances route to the default daemon
- **AND** the EC2 provisioner code in `packages/api/src/lib/instance-provisioner.ts` (Ec2ContainerProvisioner class) remains in the codebase but is not instantiated

#### Scenario: EC2 provisioner rejects at startup

- **WHEN** `INSTANCE_PROVISIONER` is set to `ec2` in this version
- **THEN** `getProvisioner()` throws `Error("INSTANCE_PROVISIONER=ec2 is not yet supported in the default-daemon-sandbox era. It will be enabled when daemon containerization is complete. Until then, all instances use the default shared daemon.")` 
- **AND** the process refuses to start

#### Scenario: Mock provisioner unaffected by default daemon

- **WHEN** a test or dev environment sets `INSTANCE_PROVISIONER=mock`
- **THEN** the `MockProvisioner` continues to function identically to its current behavior
- **AND** the default daemon row (if created by bootstrap) is independent and does not interfere with mock instances

## MODIFIED Requirements

### Requirement: Pluggable provisioner backend

The system SHALL define an `InstanceProvisioner` interface with `provision()` and `deprovision()` methods, and SHALL select the active implementation via the `INSTANCE_PROVISIONER` environment variable. v1 ships the `mock` implementation; the real bin-packed EC2 container backend is deferred pending daemon containerization.

#### Scenario: Mock backend selected by default

- **WHEN** `INSTANCE_PROVISIONER` is unset or equals `mock`
- **THEN** `getProvisioner()` returns the `MockProvisioner` instance
- **AND** `provision()` returns a synthetic bearer token, a derived `baseURL`, `ready: true`, and a `provisionerInstanceId` prefixed `mock-`, without any network call

#### Scenario: Unknown backend rejected at startup

- **WHEN** `INSTANCE_PROVISIONER` is set to any value other than `mock` (e.g. `ec2`, `fly`, `k8s`)
- **THEN** `getProvisioner()` throws at startup with a message describing the deferred `ec2` backend or the removed `fly` backend
- **AND** the process refuses to start

#### Scenario: Interface stability across implementations

- **WHEN** a future implementation replaces the mock
- **THEN** the procedure layer (`instance.provision`, `instance.retryProvision`, `instance.deprovision`) SHALL NOT require any changes
- **AND** the `provisionerInstanceId` column SHALL accept any opaque string the new backend produces

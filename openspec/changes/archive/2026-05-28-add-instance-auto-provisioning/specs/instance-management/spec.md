## ADDED Requirements

### Requirement: Auto-provision managed daemon instance

The system SHALL provide an `instance.provision` mutation that creates a new `ControlaiInstance` row in `PROVISIONING` state and asynchronously spawns a daemon via the configured `InstanceProvisioner`, without requiring the user to supply a `baseURL` or `bearerToken`.

#### Scenario: Successful provision

- **WHEN** an org owner or admin calls `instance.provision({ orgId, name, env: 'prod' })`
- **AND** no instance with the same `(orgId, env)` already exists
- **THEN** the server derives `baseURL = https://${org.slug}-prod.${DAEMON_BASE_DOMAIN}`
- **AND** inserts a row with `status='PROVISIONING'`, `provisioningStartedAt=NOW()`, `env='prod'`, `bearerTokenEnc=encryptToken('PLACEHOLDER')`
- **AND** returns `{ instanceId }` within 500ms
- **AND** a background task calls the provisioner, on success updates the row to `status='HEALTHY'` with the real encrypted bearer token, version, and `provisionerInstanceId`
- **AND** writes an audit log with action `instance.provision`

#### Scenario: Collision on (org, env) tuple

- **WHEN** an instance with the same `(orgId, env)` already exists
- **THEN** the mutation rejects with `CONFLICT` and a message identifying the existing instance
- **AND** no row is inserted

#### Scenario: Provisioner failure

- **WHEN** the background `InstanceProvisioner.provision()` throws
- **THEN** the row is updated to `status='PROVISION_FAILED'`
- **AND** an audit log with action `instance.provisionFailed` is written including the structured error
- **AND** the row is NOT deleted; the user may invoke `instance.retryProvision`

#### Scenario: Non-admin caller

- **WHEN** a member with role `MEMBER` calls `instance.provision`
- **THEN** the mutation rejects with `FORBIDDEN`

#### Scenario: Bearer token never persists plaintext

- **WHEN** the provisioner returns a plaintext bearer token
- **THEN** the procedure SHALL pass it through `encryptToken()` before any DB write
- **AND** the plaintext value SHALL NOT appear in logs, audit metadata, or error messages

### Requirement: Derive subdomain from org slug and env

The system SHALL compute the daemon `baseURL` server-side from the organization's immutable `slug` and the chosen `env`, never accepting a raw URL from the client during provisioning.

#### Scenario: URL derivation format

- **WHEN** an org with `slug='acme'` provisions `env='staging'`
- **THEN** the derived `baseURL` is `https://acme-staging.${DAEMON_BASE_DOMAIN}`

#### Scenario: Missing organization slug

- **WHEN** the organization referenced by `orgId` has a null or empty `slug`
- **THEN** the mutation rejects with `PRECONDITION_FAILED`
- **AND** no row is inserted and no provisioner call is made

### Requirement: Retry provisioning for stuck or failed instances

The system SHALL provide an idempotent `instance.retryProvision` mutation that re-invokes the provisioner for a row currently in `PROVISIONING` or `PROVISION_FAILED` state.

#### Scenario: Retry a failed provision

- **WHEN** an admin calls `instance.retryProvision({ instanceId })` on a row with `status='PROVISION_FAILED'`
- **THEN** the row is updated to `status='PROVISIONING'` with `provisioningStartedAt=NOW()`
- **AND** the background `provisionTask` is fired again

#### Scenario: Retry rejected for invalid state

- **WHEN** retryProvision is called on a row with `status='HEALTHY'` or `status='DEGRADED'`
- **THEN** the mutation rejects with `BAD_REQUEST`

#### Scenario: Retry rejected for BYO row

- **WHEN** retryProvision is called on a row where `env IS NULL` (BYO registered via `instance.register`)
- **THEN** the mutation rejects with `BAD_REQUEST`

### Requirement: Deprovision managed instance

The system SHALL provide an `instance.deprovision` mutation that tears down the underlying daemon via the provisioner and deletes the `ControlaiInstance` row, but only when no `Project` references it and the caller is the organization OWNER.

#### Scenario: Deprovision succeeds

- **WHEN** the OWNER calls `instance.deprovision({ instanceId })`
- **AND** zero `Project` rows reference the instance
- **THEN** the system calls `provisioner.deprovision()` if `provisionerInstanceId` is set
- **AND** deletes the `ControlaiInstance` row
- **AND** writes an audit log with action `instance.deprovision`

#### Scenario: Deprovision refused — projects attached

- **WHEN** at least one `Project` references the instance
- **THEN** the mutation rejects with `BAD_REQUEST` listing the project names
- **AND** the row and underlying daemon remain

#### Scenario: Deprovision refused — non-OWNER

- **WHEN** the caller's role is `ADMIN` or `MEMBER`
- **THEN** the mutation rejects with `FORBIDDEN`

### Requirement: Pluggable provisioner backend

The system SHALL define an `InstanceProvisioner` interface with `provision()` and `deprovision()` methods, and SHALL select the active implementation via the `INSTANCE_PROVISIONER` environment variable. v1 ships only the `mock` implementation; the real bin-packed EC2 container backend is delivered in a follow-up spec.

#### Scenario: Mock backend selected by default

- **WHEN** `INSTANCE_PROVISIONER` is unset or equals `mock`
- **THEN** `getProvisioner()` returns the `MockProvisioner` instance
- **AND** `provision()` returns a synthetic bearer token, a derived `baseURL`, `ready: true`, and a `provisionerInstanceId` prefixed `mock-`, without any network call

#### Scenario: Unknown backend rejected at startup

- **WHEN** `INSTANCE_PROVISIONER` is set to any value other than `mock` (e.g. `ec2`, `fly`, `k8s`)
- **THEN** `getProvisioner()` throws at startup with a message naming the follow-up spec that will introduce real backends
- **AND** the process refuses to start

#### Scenario: Interface stability across implementations

- **WHEN** a future implementation replaces the mock
- **THEN** the procedure layer (`instance.provision`, `instance.retryProvision`, `instance.deprovision`) SHALL NOT require any changes
- **AND** the `provisionerInstanceId` column SHALL accept any opaque string the new backend produces

### Requirement: Auto-cleanup stuck failed provisions

The system SHALL run a periodic cleanup that removes `ControlaiInstance` rows with `status='PROVISION_FAILED'` older than 24 hours, best-effort deprovisioning the underlying daemon first.

#### Scenario: Failed row older than 24h is cleaned

- **WHEN** a row has `status='PROVISION_FAILED'` and `updatedAt < NOW() - 24h`
- **THEN** the cleanup job calls `provisioner.deprovision()` if `provisionerInstanceId` is set (best-effort; errors are swallowed)
- **AND** deletes the row
- **AND** writes an audit log with action `instance.autoCleanup`

#### Scenario: Cleanup skipped if status changed

- **WHEN** the cleanup transaction re-reads a row mid-flight and finds `status` is no longer `PROVISION_FAILED` (e.g., user clicked retry)
- **THEN** the row is NOT deleted

#### Scenario: Recent failed row is preserved

- **WHEN** a row has `status='PROVISION_FAILED'` but `updatedAt >= NOW() - 24h`
- **THEN** the cleanup job leaves it untouched

### Requirement: BYO registration path is preserved

The system SHALL leave the existing `instance.register` mutation (BYO daemon path) bit-for-bit unchanged. Rows created via `instance.register` SHALL have `env IS NULL` and SHALL be exempt from the `(orgId, env)` uniqueness constraint, retry, and auto-cleanup logic.

#### Scenario: BYO row excluded from collision check

- **WHEN** an org has one BYO row (`env IS NULL`) and provisions a new `env='prod'` row
- **THEN** the provision succeeds; the partial unique index does not consider `env IS NULL` rows

#### Scenario: BYO row cannot be retried via retryProvision

- **WHEN** `instance.retryProvision` is called on a row with `env IS NULL`
- **THEN** the mutation rejects with `BAD_REQUEST`

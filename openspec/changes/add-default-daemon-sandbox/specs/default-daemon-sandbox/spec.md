# Default Daemon Sandbox Specification

Defines the default shared daemon deployment model, multi-tenant architecture, and canvas-driven configuration interface for the IoT sandbox testing environment. Users can configure broker, ingest, and TimescaleDB settings directly from the canvas, drag-and-drop real or synthetic sensor nodes, and immediately see signals flowing through the full pipeline without any per-org infrastructure provisioning.

## ADDED Requirements

### Requirement: Default Daemon Deployment Model

The default daemon SHALL run on a single shared EC2 instance under controlai-company's ownership, accessed via TLS at `https://default.daemons.controlai.io`. It is not containerized and not deployed via ECS; it runs the `controlai` binary directly via systemd service on a t3.medium EC2 instance.

#### Scenario: Daemon accessible via public URL with TLS

- **WHEN** a user's canvas connects to the daemon
- **THEN** the HTTPS URL `https://default.daemons.controlai.io` SHALL be reachable
- **AND** the TLS certificate is valid (issued by Let's Encrypt via Caddy auto-renewal)
- **AND** the daemon listens internally on `localhost:8080` (HTTP only)

#### Scenario: Caddy terminates TLS and forwards to daemon

- **WHEN** a client connects to `https://default.daemons.controlai.io:443`
- **THEN** Caddy reverse-proxy (running on the same EC2) terminates the TLS handshake
- **AND** forwards the request to the daemon on `localhost:8080`
- **AND** caches and compresses responses

#### Scenario: Single t3.medium instance serves all orgs

- **WHEN** multiple organizations simultaneously use the default daemon
- **THEN** all are served from the same EC2 instance
- **AND** isolation is enforced at the daemon tenant level (not at the machine level)

### Requirement: Multi-Tenant Model—tenantId Equals Organization.id

Inside the daemon, each ControlAI `Organization` SHALL map directly to exactly one tenant. The tenant ID SHALL equal the organization's `id` (not a generated UUID). This enables straightforward audit trails and role-based access control.

#### Scenario: Org creates tenant on first apply

- **WHEN** an organization's canvas is applied for the first time
- **AND** no daemon tenant exists yet for `tenantId = Organization.id`
- **THEN** the apply flow calls `POST /v1/tenants/{ Organization.id }`
- **AND** the daemon creates the tenant
- **AND** subsequent applies reference the same tenant

#### Scenario: Tenant ID equals org ID

- **WHEN** an organization with `id='org_acme123'` applies canvas changes
- **THEN** all daemon API calls use path `/v1/tenants/org_acme123`
- **AND** the daemon's records reference `tenant_id = 'org_acme123'`

#### Scenario: Cross-org data isolation via tenant ID

- **WHEN** Organization A queries the daemon for broker state
- **THEN** Organization B's data is not visible (the daemon filters by tenant)
- **AND** no cross-org tenant leak can occur due to ID scoping

### Requirement: Factory-QA-Unclaimed Tenant for Pre-Flashed Factory Boards

A special reserved tenant `factory-qa-unclaimed` SHALL receive factory boards before they are claimed by an organization. All factory boards ship with hardcoded firmware pointing to `group_id='factory-qa-unclaimed'`, landing in this shared tenant on first boot.

#### Scenario: Factory boards land in unclaimed tenant

- **WHEN** a factory board powers on with pre-flashed credentials (`group_id='factory-qa-unclaimed'`, default MQTT cert/key)
- **THEN** the board connects to the broker and registers itself with the daemon
- **AND** the daemon assigns it to the `factory-qa-unclaimed` tenant (not to any specific org)
- **AND** signals are published under `factory-qa-unclaimed` namespace

#### Scenario: Admin sees unclaimed boards

- **WHEN** an organization admin accesses `/admin/unclaimed-boards`
- **THEN** a tRPC query fetches all devices in the `factory-qa-unclaimed` tenant
- **AND** displays their `realUuid`, `lastSeenAt`, `lastSignalPreview`

#### Scenario: Unclaimed tenant cleanup and isolation

- **WHEN** unclaimed boards are not claimed for 90 days (configurable, future spec)
- **THEN** a background job MAY archive or deprovision them
- **AND** the `factory-qa-unclaimed` tenant remains isolated from org-specific tenants

### Requirement: Per-Org Reset Semantics

Applying canvas changes to the default daemon SHALL support full reconfiguration ("reset") of only the current org's tenant slice. Other orgs' tenants are unaffected. Reset uses the existing CRUD operations: `DELETE /v1/tenants/{orgId}` (idempotent drop) followed by `POST /v1/tenants/{ orgId }` (recreate) and re-apply of all configuration.

#### Scenario: Reset affects only caller's org

- **WHEN** an organization applies a radically different canvas config (e.g. broker type change from Mosquitto → EMQX)
- **AND** the apply operation detects a breaking change
- **THEN** the system calls `DELETE /v1/tenants/{orgId}` (wipes all data in that tenant)
- **AND** calls `POST /v1/tenants/{ orgId }` (recreates the tenant)
- **AND** other organizations' tenants remain untouched and operational

#### Scenario: Cross-org data preserved

- **WHEN** Organization A resets its sandbox
- **THEN** Organization B's data in the same daemon instance is not affected
- **AND** Organization B's broker, ingest, and TSDB remain operational

#### Scenario: Full reapply after delete

- **WHEN** the tenant is recreated, the apply flow calls all necessary setup ops in sequence
- **THEN** broker is configured, ingest mode is set, TSDB retention is applied
- **AND** the canvas state is fully restored

### Requirement: Explicit Apply with Preview

Canvas changes SHALL only push to the default daemon via an explicit "Apply" button. Users must click Apply to execute any changes. The Apply flow always shows a preview (diff) before confirmation, matching the existing `apply.preview` → `apply.commit` modal workflow.

#### Scenario: Explicit apply required

- **WHEN** a user makes canvas changes (drop nodes, edit config, rearrange edges)
- **THEN** the changes are saved locally to `NodeConfig` (autosave every 30s)
- **AND** no changes are pushed to the daemon until the user clicks "Apply"

#### Scenario: Preview renders diff before commit

- **WHEN** a user clicks "Apply"
- **THEN** a modal opens showing `apply.preview` result
- **AND** displays all planned ops: "Create site", "Configure broker (mosquitto)", "Set retention (7 days)", "Bind devices", etc.
- **AND** the user must click "Confirm" before ops are executed

#### Scenario: No changes yields no-op

- **WHEN** a user applies a canvas with zero diffs since the last apply
- **THEN** the preview shows no operations
- **AND** the user can close the modal without any daemon mutation

### Requirement: Best-Effort Rollback on Failed Apply

If a daemon operation fails during apply, the daemon MAY be left in a partial or inconsistent state. The error SHALL be surfaced to the user, and the user can manually adjust the canvas and retry. No transactional staging or automatic rollback SHALL be performed.

#### Scenario: Partial failure surfaces error

- **WHEN** an apply operation fails at the 3rd op (e.g. `configureDriver` fails due to an invalid ingest topology)
- **THEN** the first 2 ops (createTenant, createSite) may have already executed
- **AND** the UI shows an error: "Provisioning failed at step 3: Invalid ingest configuration. Please fix and reapply."

#### Scenario: Retry recovers from error

- **WHEN** the user edits the canvas to fix the invalid ingest config
- **AND** clicks Apply again
- **THEN** the new apply attempt reuses the existing tenant and site (ops are idempotent via 409 collision handling)
- **AND** the system successfully completes the remaining ops

#### Scenario: No rollback attempted

- **WHEN** a failure occurs mid-apply
- **THEN** the system does NOT call `DELETE /v1/tenants/{orgId}` to roll back
- **AND** instead leaves the daemon in a partially-configured state for the user to recover from

### Requirement: Canvas Pushes Full Pipeline Config

When Apply executes, the canvas state SHALL be synthesized into daemon REST operations that cover broker type (Mosquitto vs. EMQX), TimescaleDB retention period (days), ingest mode, and gateway settings. These SHALL be existing daemon endpoints only; no new endpoints are created. The system SHALL reuse existing `createTenant`, `createSite`, `configureDriver`, and `updateSite` operations.

#### Scenario: Broker type is pushed to daemon

- **WHEN** a canvas site-level config specifies `brokerKind='EMQX'`
- **AND** apply is executed
- **THEN** the plan includes an op `configureDriver({ brokerKind: 'EMQX' })`
- **AND** the daemon updates the site's broker configuration

#### Scenario: Retention days are pushed to daemon

- **WHEN** a canvas site-level config specifies `retentionDays=30`
- **THEN** the plan includes an op `updateSite({ retentionDays: 30 })`
- **AND** the daemon applies the retention policy to TimescaleDB

#### Scenario: Mixed config applied atomically

- **WHEN** a single apply operation changes broker kind, retention, and adds/removes devices
- **THEN** all ops are executed in a deterministic order (sites before devices)
- **AND** either all succeed or the daemon is left in a consistent partial state

### Requirement: Admin Unclaimed Boards Route

An admin-only route `/admin/unclaimed-boards` SHALL list all devices currently in the `factory-qa-unclaimed` tenant, showing metadata, last-seen timestamp, and signal preview. Access is restricted to `ORG_ADMIN` role.

#### Scenario: Admin can list unclaimed boards

- **WHEN** a user with role `ORG_ADMIN` navigates to `/admin/unclaimed-boards`
- **THEN** the page loads successfully
- **AND** displays a table of unclaimed boards: Device ID, Last Seen, Last Signal, Status

#### Scenario: Non-admin access rejected

- **WHEN** a user with role `MEMBER` tries to access `/admin/unclaimed-boards`
- **THEN** the route returns HTTP 403 Forbidden
- **AND** displays an access-denied message

#### Scenario: Query returns tenant devices

- **WHEN** the tRPC `admin.unclaimedBoards.list` is called
- **THEN** it fetches all devices from the daemon's `factory-qa-unclaimed` tenant
- **AND** returns `{ realUuid, lastSeenAt, lastSignalPreview, ... }` for each device

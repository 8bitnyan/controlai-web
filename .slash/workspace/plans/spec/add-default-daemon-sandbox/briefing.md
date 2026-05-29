# Briefing: add-default-daemon-sandbox

This document is the consolidated design briefing for the OpenSpec change `add-default-daemon-sandbox`. It captures all locked-in decisions from the AUQ interview round (35 explicit Q/A from the operator) plus the research findings from 3 explorer + 3 researcher agents. The document-writer subagent uses this to author `proposal.md`, `design.md`, `tasks.md`, and the per-capability `specs/*/spec.md` deltas.

---

## Problem statement

The current `controlai-web` provisioning architecture (delivered by the just-shipped `add-ec2-container-provisioner` spec) auto-creates per-org `ControlaiInstance` rows in **`mock`** mode by default. Every new daemon shows `Version: mock-0.0.0` and no real signals flow because:

1. The `Ec2ContainerProvisioner` deploy is blocked on a non-existent daemon Docker image — daemon containerization is deferred to a separate `../controlai` spec.
2. The canvas (`apps/web/components/canvas/`) already pushes **device registration** ops to a daemon via `apply.preview` / `apply.commit`, but it **does not push broker / ingest / TimescaleDB / gateway settings**. Users cannot configure these via the canvas today.
3. There is no single shared daemon any user can target out-of-the-box. The factory boards your company ships (pre-flashed with cert + endpoint URL + default `group_id`) have nowhere to land.
4. There is no admin / QA view of "unclaimed" factory boards landing on a default daemon — required for the factory-floor connectivity check workflow.

The operator wants users to drag-and-drop canvas nodes representing real or simulated hardware, hit Apply, and **immediately see synthetic signals flowing through broker → ingest → TimescaleDB → dashboard** — proving the entire pipeline works before any real hardware is wired. Factory boards that ship with the default cert/URL/group_id must show up automatically in an admin view for QA.

## Solution sketch

1. **Deploy one manually-provisioned EC2 default daemon** (no ECS, no container — `controlai` binary on a bare EC2 host via the existing systemd install path under `../controlai/deploy/install/install.sh`). Caddy + Let's Encrypt fronts it at `default.daemons.controlai.io`.
2. **Auto-bootstrap a singleton `ControlaiInstance` row per org** at signup (better-auth hook), pre-populated with the default daemon's `baseURL` + `bearerTokenEnc`. Hide the existing `Create instance` UI; replace with a read-only health pill.
3. **Multi-tenant inside the daemon by `tenantId = Organization.id`** — direct 1:1 mapping. Existing `apply.ts` already does `createTenant` per Site; this spec extends it to use the org's ID rather than a Site-scoped ID.
4. **Extend canvas + apply to push full pipeline config**: broker kind (mosquitto | EMQX), TimescaleDB retention (days), ingest settings, gateway settings — all via the existing `daemon-client.ts` → daemon REST ops (no new `/v1/reload` endpoint; reuse `createTenant` / `createSite` / `configureDriver` / `updateSite` ops idempotently to achieve "reset semantics" per-org).
5. **Add 6 new device-type manifests** in `packages/shared-types/src/device-types/core/generic-*` (vendor-neutral):
   - `generic-main-gateway` (gateway category)
   - `generic-sensor-input` (sensor category, child of gateway; has crack-noise-encoder + RS-485 x2 ports)
   - `generic-tilt-linear` (sensor category, child of gateway; chainable via `chainLength` config field, default 4, max 16)
   - `generic-vibration-tilt-standalone` (sensor category, child of gateway)
   - `generic-control-485x2` (sensor category, child of gateway; 2 RS-485 child slots)
   - `generic-vibrating-wire-sensor-input` (sensor category, child of gateway)
   - `generic-noise-meter` (sensor category, attached child of `generic-sensor-input` only — modeled via existing `Device.parentDeviceKey` field; CPU-less)
6. **Extend `apps/simulator` with 5 typed signal generators** (~300 LOC, no new deps): tilt, vibration, crack-encoder, noise-meter, vibrating-wire. Maps 1:1 to the 6 manifests (gateway has no signal). Math models documented in `.slash/workspace/research/spec-default-daemon-sandbox-mqtt-faker.md` §3.
7. **Sandbox semantics on the canvas**:
   - Dashed border + ghost icon = `UNREGISTERED` (synthetic)
   - Solid border = `REGISTERED` (real factory board reporting in)
   - Mixed real + synthetic supported in one canvas
   - Inline live sparkline per node (extend existing `canvas-store.updateNodeTelemetry`)
   - Explicit `Apply` button (no autosave-apply); reuse preview modal; best-effort rollback (sandbox = data-loss-acceptable)
8. **Admin `/admin/unclaimed-boards` route** showing factory-bucketed boards landing on the default daemon's special `factory-qa-unclaimed` tenant — `realUuid`, `lastSeenAt`, last-signal preview. Claim flow (OTA cert/URL/group_id push) deferred to a follow-up spec.

## Locked-in decisions (35 Q/A from interview)

### Default daemon physical / runtime model

| #  | Decision                                                                                                                                                                                                                   |
| -- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | Deployed on a **single EC2 instance, manually provisioned, controlai binary via systemd** (re-use `../controlai/deploy/install/install.sh` + `../controlai/deploy/systemd/*`). NOT containerized. NOT via the ECS provisioner. |
| 2  | TLS via **Caddy reverse-proxy + Let's Encrypt** for the public hostname `default.daemons.controlai.io`. Daemon listens HTTP-only on a private port; Caddy terminates TLS.                                                       |
| 3  | **Always shared** — there is no localhost variant. Dev and prod both point to the same EC2 daemon.                                                                                                                              |
| 4  | Multi-tenant inside the daemon: **one tenant per `Organization`**. `tenantId = Organization.id` (direct 1:1; no separate generated ID).                                                                                          |
| 5  | Special bootstrap tenant: **`factory-qa-unclaimed`** receives all factory boards before they are claimed by an org. Listed in admin view.                                                                                          |
| 6  | **Reset scope = current org's tenant only** (delete + recreate that tenant's broker/ingest/tsdb config; never touch other orgs).                                                                                                |
| 7  | **Factory board provisioning**: all boards ship from factory with hardcoded firmware-burned default endpoint URL (`default.daemons.controlai.io`) + factory-wide shared MQTT mTLS client cert + default `group_id` (`factory-qa-unclaimed`). |
| 8  | Boards reach default daemon at first boot; admin sees them under `factory-qa-unclaimed` tenant in `/admin/unclaimed-boards`.                                                                                                       |

### `ControlaiInstance` bootstrap & UI

| #  | Decision                                                                                                                                                                                                                                                                                                |
| -- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9  | Every new `Organization` auto-creates a **singleton `ControlaiInstance` row** pointing at the default daemon. Via better-auth `org.created` hook.                                                                                                                                                                |
| 10 | `ControlaiInstance.baseURL` and `bearerTokenEnc` come from env vars (`DEFAULT_DAEMON_BASE_URL`, `DEFAULT_DAEMON_BEARER_TOKEN`).                                                                                                                                                                              |
| 11 | The existing `Create instance` button in `/orgs/[orgId]/instances` is **hidden** (or replaced by a read-only "Sandbox daemon: HEALTHY / DEGRADED / UNREACHABLE" status pill with last-seen-at).                                                                                                                  |
| 12 | Existing **mock `ControlaiInstance` rows are soft-archived** (marked `legacy = true` in a new column, hidden from default listings). No hard delete. New orgs always get the default daemon row.                                                                                                                  |
| 13 | The shipped `Ec2ContainerProvisioner` code is **deferred** (left on disk, unused). `INSTANCE_PROVISIONER=mock` stays the default for any non-default-daemon instances.                                                                                                                                            |
| 14 | Auth for controlai-web → default daemon: **reuse existing bearer-token-in-`ControlaiInstance` pattern** (one bearer token for the entire daemon, stored encrypted on every org's row).                                                                                                                              |

### Canvas + apply semantics

| #  | Decision                                                                                                                                                                                                                                                                          |
| -- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 15 | **Explicit Apply button only** (no autosave-apply). Reuse existing `ApplyModal` flow with `apply.preview` → `apply.commit`.                                                                                                                                                                |
| 16 | **Always show preview/diff** before commit. Show diff: tenant changes, broker switches, retention changes, table drops/creates.                                                                                                                                                                  |
| 17 | **Best-effort rollback** on failed apply (sandbox = data-loss-acceptable per research §7). Failure leaves daemon in partial state; surface error in dialog; user can fix and retry. No transactional staging.                                                                                       |
| 18 | **Visual node state**: dashed border + ghost icon for `UNREGISTERED`, solid border for `REGISTERED`. (Existing `DeviceNode` already shows the textual badge — this adds the border styling.)                                                                                                            |
| 19 | **Mixed real + synthetic nodes on same canvas** is **first-class**. No mode toggle. Each node's `registrationState` determines whether the synthetic generator emits for it.                                                                                                                                |
| 20 | **No new `/v1/reload` endpoint** in the daemon. Reuse existing `createTenant` / `createSite` / `configureDriver` / `updateSite` ops in `apply-planner.ts` / `apply-executor.ts`. For "reset", first `DELETE /v1/tenants/{orgId}` (or PATCH to clear), then re-apply from canvas snapshot.                  |
| 21 | The existing **`apply.preview` 10-min plan-cache TTL** is preserved.                                                                                                                                                                                                                                  |

### Synthetic generator (in `apps/simulator`)

| #  | Decision                                                                                                                                                                                                                                                                                                                                              |
| -- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 22 | Add **5 typed signal generator classes** in `apps/simulator/src/generators/`: `TiltGenerator`, `VibrationGenerator`, `CrackEncoderGenerator`, `NoiseMeterGenerator`, `VibratingWireGenerator`. Pure TypeScript, ~300 LOC total, zero new deps. Math models from research doc §3.                                                                                |
| 23 | **Reuse existing `apps/simulator`** (Hono + mqtt v5.15.1 standalone process). Do NOT embed in Next.js. Do NOT create a new package. Add the generators behind a `pattern` discriminator in `SensorConfig` schema.                                                                                                                                                |
| 24 | **mTLS authentication via existing per-gateway cert provisioning**: when canvas Apply creates a synthetic-mode gateway, the existing `gateway.issueFromDaemon` flow already issues an mTLS cert via daemon PKI. Generator reads `Gateway.clientCertPemEnc`. Zero new auth code.                                                                                       |
| 25 | **MQTT only** for v1. No HTTP-direct-ingest alternative path. Synthetic generator publishes to the daemon's broker (via Caddy if needed), broker → ingest → TSDB flows naturally.                                                                                                                                                                                |
| 26 | **Per-node rate config** in `node-config-dialog`: 3 fields — `intervalMs` (default 1000), `valueMin`, `valueMax`. Generator picks waveform/pattern based on `deviceTypeId` (1:1 with the 5 generators).                                                                                                                                                              |
| 27 | Synthetic generator runs on a separate EC2 instance OR co-located with the default daemon (operator choice; install instructions in tasks.md cover both).                                                                                                                                                                                                            |

### Device-type registry additions

| #  | Decision                                                                                                                                                                                                                                                                                                                                                                                                  |
| -- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 28 | New manifests live under **`packages/shared-types/src/device-types/core/generic-*`** (vendor-neutral). 6 new manifests + 1 attached child (noise meter modeled as an attached child of `generic-sensor-input` via `Device.parentDeviceKey`).                                                                                                                                                                          |
| 29 | **Port topology uses sensible defaults**: `generic-control-485x2` has 2 RS-485 child slots; `generic-sensor-input` has 1 crack-noise encoder slot + 1 noise-meter attached slot + 2 RS-485 child slots; chainable `generic-tilt-linear` has a `chainLength` config field (1..16, default 4). Refine specifics in a follow-up spec when hardware is finalized.                                                                |
| 30 | Connection rules updated in `packages/shared-types/src/registration.ts` to allow the new manifests under gateway-category parents.                                                                                                                                                                                                                                                                                |

### Broker + TSDB config surface

| #  | Decision                                                                                                                                                                                                                                                                          |
| -- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 31 | **Both Mosquitto AND EMQX** supported as broker kinds (existing `Site.brokerKind` already supports both). Add UI dropdown in broker-node config dialog. The daemon currently spawns the chosen broker as a Docker Compose project; nothing new on the daemon side.                                  |
| 32 | **TSDB v1 surface = retention days only** (per-site). Hypertable / chunk size / compression use sane daemon defaults. Add UI field in timescaledb-node config dialog.                                                                                                                                |

### Telemetry & UX preview

| #  | Decision                                                                                                                                                                                                                                                                                                                                |
| -- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 33 | **Inline per-node sparkline** on each canvas node showing last 30s of telemetry. Extend existing `canvas-store.updateNodeTelemetry` + SSE plumbing. Show "no data" placeholder for synthetic nodes whose generator hasn't started yet.                                                                                                            |

### Admin + scope boundaries

| #  | Decision                                                                                                                                                                                                                                                                                  |
| -- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 34 | New admin route **`/admin/unclaimed-boards`** (org-admin-only auth gate). Lists boards in `factory-qa-unclaimed` tenant. Shows `realUuid`, `lastSeenAt`, last sample value preview, signal type heuristic. No claim button in this spec.                                                                       |
| 35 | **Out of scope** for this spec: board claim/OTA flow (follow-up `add-board-claim-flow`), daemon containerization (`../controlai` add-managed-tier-container-mode), per-org dedicated daemons (the deferred ECS provisioner), advanced TSDB knobs, subscription tiering, billing / cost recovery. |

### Acceptance criteria (Done gate)

User drags **1 `generic-main-gateway` + 3 `generic-sensor-input` (each with attached `generic-noise-meter`) + 1 `generic-tilt-linear` (chainLength=4)** onto the canvas → clicks **Apply** → preview shows the diff → confirms → sees synthetic signals **appear in inline sparklines within 10 seconds end-to-end** (browser → tRPC → daemon REST → broker → ingest → TSDB → SSE back to browser → sparkline).

---

## Affected capabilities (specs)

### `instance-management` — MODIFIED

- Add singleton default-daemon bootstrap (better-auth hook).
- Hide `Create instance` UI; replace with read-only health pill.
- Soft-archive existing mock instances (add `legacy` boolean column + filter from default listings).
- Default daemon row fields (`baseURL`, `bearerTokenEnc`) populated from env vars at signup time.

### `device-type-registry` — MODIFIED

- Add 7 new manifests (6 + 1 attached) under `core/generic-*`.
- Each manifest declares: id, displayName (with Korean label), category, ports, defaultSignals, chainable config (for tilt-linear), parent-attached config (for noise-meter).
- Connection rules updated.

### `device-lifecycle` — MODIFIED

- Visual canvas state: dashed border for UNREGISTERED, solid for REGISTERED.
- Mixed-mode canvas (real + synthetic in same site-group) is first-class.
- Per-node inline sparkline rendering.
- node-config-dialog gains `intervalMs`, `valueMin`, `valueMax` for synthetic nodes.

### `gateway-board-provisioning` — MODIFIED

- Synthetic-mode gateway uses 5 typed signal generators based on attached child device types.
- Per-gateway mTLS cert provisioning flow unchanged (already covers synthetic gateways).
- `SensorConfig` schema gains `pattern` discriminator + pattern-specific params.

### `default-daemon-sandbox` — NEW

- Default daemon deployment (manual EC2 + systemd + Caddy + LE).
- Org → tenant mapping (`tenantId = Organization.id`).
- Reset semantics: per-org slice; reuse existing CRUD ops; no new `/v1/reload`.
- Apply pipeline extension: broker_kind + tsdb retention + ingest settings pushed via canvas Apply.
- Best-effort rollback semantics.
- Admin `/admin/unclaimed-boards` route.

---

## Affected code (rough)

| File / dir                                                                       | Change                                                                                              |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `packages/db/prisma/schema.prisma`                                                 | Add `ControlaiInstance.legacy Boolean @default(false)` column; index update                          |
| `packages/db/prisma/migrations/`                                                   | New migration for `legacy` column                                                                   |
| `apps/web/app/(app)/orgs/[orgId]/instances/page.tsx`                                | Hide create button when default daemon exists; show health pill                                     |
| `apps/web/lib/auth/hooks.ts` (or wherever better-auth hooks live)                  | New `org.created` hook to seed `ControlaiInstance` row                                              |
| `apps/web/app/(app)/admin/unclaimed-boards/page.tsx` (new)                         | New admin route                                                                                     |
| `packages/api/src/routers/admin.ts` (new or extend)                                | New `unclaimedBoards.list` procedure                                                                |
| `packages/api/src/routers/instance.ts`                                             | Add `defaultDaemon.bootstrap` mutation; filter `legacy` from `list`                                  |
| `packages/api/src/routers/apply.ts`                                                | Extend `apply-planner` to include broker_kind / retention / ingest settings in plan ops              |
| `packages/api/src/lib/apply-planner.ts`                                            | Add ops: `configureBrokerKind`, `setRetention`, `setIngestMode`                                      |
| `packages/api/src/routers/nodeConfig.ts`                                           | Validate new device-type manifests; auto-create attached-child Device rows                          |
| `packages/shared-types/src/device-types/core/generic-main-gateway.ts` (new)        | Manifest                                                                                            |
| `packages/shared-types/src/device-types/core/generic-sensor-input.ts` (new)        | Manifest                                                                                            |
| `packages/shared-types/src/device-types/core/generic-tilt-linear.ts` (new)         | Manifest with chainLength config field                                                              |
| `packages/shared-types/src/device-types/core/generic-vibration-tilt-standalone.ts` (new) | Manifest                                                                                            |
| `packages/shared-types/src/device-types/core/generic-control-485x2.ts` (new)       | Manifest                                                                                            |
| `packages/shared-types/src/device-types/core/generic-vibrating-wire.ts` (new)      | Manifest                                                                                            |
| `packages/shared-types/src/device-types/core/generic-noise-meter.ts` (new)         | Manifest (attached child of generic-sensor-input)                                                   |
| `packages/shared-types/src/device-types/index.ts`                                  | Wire new manifests into registry                                                                    |
| `apps/web/components/canvas/nodes/device-node.tsx`                                 | Add dashed-vs-solid border styling based on `registrationState`; inline sparkline render             |
| `apps/web/components/canvas/canvas.tsx`                                            | Extend `updateNodeTelemetry` consumption to feed sparklines                                         |
| `apps/web/components/canvas/nodes/node-config-dialog.tsx`                          | Add intervalMs / valueMin / valueMax fields for synthetic nodes; broker_kind dropdown; retention field |
| `apps/simulator/src/signal-generator.ts` + new files in `src/generators/`           | Add 5 typed generator classes                                                                       |
| `apps/simulator/src/sensor-config.ts` (or wherever SensorConfig lives)              | Extend schema with `pattern` discriminator                                                          |
| `apps/web/.env.example`                                                            | Add `DEFAULT_DAEMON_BASE_URL`, `DEFAULT_DAEMON_BEARER_TOKEN`                                          |
| `docs/default-daemon-deployment.md` (new)                                          | Manual EC2 + systemd + Caddy + LE setup instructions; backup/restore                                 |

## Out of scope (explicit non-goals)

- Per-org ECS-provisioned daemons (the deferred `add-ec2-container-provisioner` work)
- Daemon containerization (separate spec in `../controlai`)
- Board claim/OTA flow (follow-up `add-board-claim-flow`)
- Per-tenant retention enforcement on the daemon side
- Advanced TSDB knobs (chunk size, compression policies)
- Subscription tiering or billing / cost recovery
- Multi-region or geo-routing
- Per-board mTLS isolation (factory-wide shared cert is accepted)
- Audit-trail surfacing in admin view (basic audit logs continue; no new admin UI for them in this spec)

## Research references

- `.slash/workspace/research/spec-default-daemon-sandbox-flowbuilder-ux.md` — Node-RED / n8n / Greengrass / ThingsBoard / FlowFuse / NiFi UX patterns + 8 concrete recommendations (R1–R8)
- `.slash/workspace/research/spec-default-daemon-sandbox-mqtt-faker.md` — Signal-generation math models for tilt / vibration / crack-encoder / noise-meter / vibrating-wire + Node.js library evaluation
- `.slash/workspace/research/spec-default-daemon-sandbox-hot-reload.md` — Per-component reset semantics (mosquitto SIGHUP scope, EMQX REST, TSDB DROP SCHEMA, ingest restart) + 5 pattern recommendations + sandbox shortcuts

## Codebase findings (from explorer agents)

- Canvas is React-Flow-based, mature: `apps/web/components/canvas/` with broker/device/gateway/ingest/monitoring/sensor/timescaledb/orphan node types (all unified under `DeviceNode` component), node-palette drag-drop via `deviceTypeId`, ApplyModal preview/commit flow, Zustand canvas-store with undo/redo, autosave every 30s.
- `apply-planner.ts` already synthesizes ordered ops: createTenant / createSite / configureDriver / migrateTopicSchema / device-bind etc. `apply-executor.ts` calls daemon REST API with idempotent 409 handling. Plan-hash matching between preview and commit.
- `Site` model owns daemon binding (`controlaiTenantId`, `controlaiSiteId`, `brokerKind`, `ingestDirection`, `throughputTier`, `retentionPeriod`, `mqttCert`, etc.). One site per canvas broker-node. SiteGroup → multiple Sites → multiple ControlaiInstances possible today (1 Project → 1 Instance, but multiple Projects → multiple Instances allowed).
- `Device` model already has `simulationDesired Boolean @default(true)`, `parentDeviceKey`, `realUuid`, `registrationState` (`UNREGISTERED`/`REGISTERING`/`REGISTERED`/`ORPHANED`), `portBindings JSON`. `RegistrationProposal` flow handles Web Serial board registration.
- `Gateway` model already supports `kind: 'simulator' | 'physical'`, `desiredState: 'running' | 'stopped'`, encrypted PEM fields, `sensors JSON` for legacy config.
- `apps/simulator` is a standalone Hono + mqtt v5 + prom-client process at `apps/simulator/src/`. Has `SignalGenerator` (bounded Gaussian random walk), TokenBucket rate control, manager.ts for per-gateway lifecycle.
- Device-type catalog: `packages/shared-types/src/device-types/` with manifests under `core/` and `daejak/`. Zod-validated. `listDeviceTypes()` returns all registered.
- 3 archived specs cover the existing canvas+device foundations: `add-plugin-device-type-registry`, `add-unregistered-device-lifecycle`, `extend-gateway-register-handshake`.

End of briefing.

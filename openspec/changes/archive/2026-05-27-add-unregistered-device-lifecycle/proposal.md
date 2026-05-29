# Change: Add unregistered-device lifecycle with first-class Device rows

## Why

Today, when a user drops a sensor or gateway on the canvas, a node entry lands in `NodeConfig.nodes` (JSON inside the SiteGroup's NodeConfig row). For gateways specifically, a `Gateway` row is created with embedded `sensors: SensorConfig[]` JSONB. There is no first-class concept of "this canvas node represents a *device* that is currently unregistered but will become registered later." Sensors do not have their own rows; they are nested inside Gateway. There is no lifecycle state (`unregistered → registering → registered`), no shadow UUID separate from the device's eventual real UUID, no per-device simulation toggle, no stable identifier that survives a UUID rewrite.

This blocks the entire flow the user described:

> *Drop 5 sensors → they auto-simulate → user builds a dashboard → later user clicks "Register Device" on the gateway → real UUIDs swap in → dashboard keeps working.*

Specifically, today:

1. **No "unregistered" flag.** Every canvas node is treated as a design-time entity; nothing distinguishes a freshly-dropped placeholder from a fully-provisioned device.
2. **Sensors are not rows.** They live as JSONB inside `Gateway.sensors`; we cannot give a sensor its own shadow UUID, lifecycle state, registration audit trail, or stable `device_key`.
3. **Topic + Redis + TSDB all key off mutable identifiers.** `groupId` and `clientId` are baked into MQTT topics and Redis stream keys, so a UUID swap would force a topic resubscribe + Redis key migration on every registration. The cross-spec invariant the user explicitly locked — *"device_key is immutable from node-drop to deletion"* — has no schema slot to live in.
4. **Dashboards cannot survive registration.** Widgets reference `{ siteId, topic }`; registering a device changes the topic; widgets break.
5. **Simulator's source of truth is Gateway.sensors.** Promoting sensors to first-class rows demands a simulator rewrite anyway; bundling it into this change keeps the migration atomic.

This change introduces the cross-cutting **`device-lifecycle`** capability that all later specs (registration handshake, multi-broker, identity rewrite) depend on. It is the foundation of every UUID swap that follows.

## What Changes

This change introduces a new capability **`device-lifecycle`** and a new first-class `Device` row in the schema. Every canvas node that represents a physical entity (sensor, gateway, broker, ingest, TSDB) gets a corresponding `Device` row with a stable `device_key` (CUID) generated at drop time, a `registrationState` enum, and a `shadowUuid`/`realUuid` alias pair. The existing `Gateway` table is preserved for runtime/simulator config and gains a `deviceKey` FK to its Device row. Sensors are extracted from `Gateway.sensors` JSONB into individual `Device` rows with `parentDeviceKey` pointing to their gateway. Dashboard widgets are migrated to bind `{ deviceKey, metric }` instead of `{ siteId, topic }`. A SiteGroup-level simulation toggle (with per-Device override) is added to the canvas toolbar.

This change **does not yet** introduce the device-side handshake protocol (spec 3) or the new topic schema / driver registry (spec 4). The `device_key` is *prepared* end-to-end — written into Device rows, exposed in API responses, surfaced in dashboards — but legacy `modules/...` topics remain in use during this change's deploy window. Spec 4 performs the actual topic rewrite.

- **NEW CAPABILITY SPEC** `device-lifecycle` — covers the Device table contract, lifecycle state machine, alias-table semantics, simulation toggle UX, dashboard binding rewrite.

- **NEW PRISMA MODEL** `Device`:
  - `deviceKey String @id` — CUID, generated at canvas drop, immutable for the lifetime of the row.
  - `siteGroupId String` (FK), `canvasNodeId String` — links to canvas position; unique together.
  - `siteId String?` (FK, nullable) — set when the device is bound to a provisioned Site (broker nodes set this directly; sensors inherit from their gateway's Site).
  - `deviceTypeId String` — FK to the manifest registry from spec 1.
  - `registrationState DeviceRegistrationState` — enum: `UNREGISTERED | REGISTERING | REGISTERED | ORPHANED`.
  - `shadowUuid String` — CUID generated at drop. Equal to `deviceKey` at insertion time; stored separately so spec 3 can swap it for `realUuid` on register without rewriting the `deviceKey`.
  - `realUuid String?` — set on successful registration (spec 3); the human-facing identifier displayed in detail views (e.g. STM32 board ID `2C004A001351353230363438`).
  - `parentDeviceKey String?` — FK to another Device; non-null for sensors under a gateway.
  - `portBindings Json?` — array describing which parent ports this device occupies, e.g. `[{ parentPortId: 'rs485-1', address: 12 }]`.
  - `config Json` — per-instance overrides on top of manifest defaults (label, signal rate, units override, etc.).
  - `simulationDesired Boolean` — defaults to true while unregistered, false once registered (auto-stop on register).
  - `registeredAt DateTime?`, `registeredByUserId String?` — audit.
  - `lastSeenAt DateTime?` — telemetry liveness, written by mqtt-bridge / tsdb-writer.
  - `createdAt`, `updatedAt`.
  - Indices: `@@unique([siteGroupId, canvasNodeId])`, `@@index([siteGroupId, registrationState])`, `@@index([parentDeviceKey])`, `@@index([realUuid])`.

- **NEW PRISMA ENUM** `DeviceRegistrationState`: `UNREGISTERED`, `REGISTERING`, `REGISTERED`, `ORPHANED`.

- **MODIFIED PRISMA MODEL** `Gateway`:
  - **Add** `deviceKey String? @unique` (FK to `Device.deviceKey`) — nullable during migration window, NOT NULL after task 2.5 completes.
  - **Add** `simulationDesired Boolean @default(false)` — gateway-level simulation flag (sensors' own flags also exist; gateway flag is an aggregate convenience for the SiteGroup toggle).
  - **Keep** `sensors Json` JSONB **for the migration window only** (read by simulator during transition; marked deprecated; dropped in task 2.7).

- **MODIFIED PRISMA MODEL** `Site`:
  - No schema change at this stage. (Spec 4 introduces `driverConfig` and friends.)

- **NEW MIGRATION SCRIPTS** under `packages/db/scripts/`:
  - `migrate-sensors-to-devices.ts` — for every existing Gateway, create one Device row per `sensors[]` entry (with `parentDeviceKey = gateway.deviceKey`); create the gateway's own Device row first. Idempotent (skips if Device row already exists). Writes a `device-migration` audit row per Gateway with the before/after counts.
  - `backfill-gateway-device-keys.ts` — for every Gateway whose `deviceKey` is null, create the corresponding Device row (category `gateway`) and link.

- **NEW tRPC ROUTER** `packages/api/src/routers/device.ts`:
  - `device.list({ siteGroupId, filter?: { registrationState?, parentDeviceKey?, deviceTypeId? } })` — returns Device rows with their manifest hydrated.
  - `device.get({ deviceKey })`.
  - `device.create({ siteGroupId, canvasNodeId, deviceTypeId, parentDeviceKey?, portBindings?, config? })` — called by canvas on node drop (after `nodeConfig.save`); enforces manifest validation; generates `deviceKey` (CUID) and `shadowUuid = deviceKey`; defaults `registrationState: 'UNREGISTERED'`, `simulationDesired: true`.
  - `device.update({ deviceKey, patch: { label?, config?, simulationDesired?, portBindings? } })` — only allowed while `registrationState === 'UNREGISTERED'` for `config` changes; `simulationDesired` always settable.
  - `device.delete({ deviceKey })` — hard-deletes only if `registrationState === 'UNREGISTERED'`; otherwise soft-archives (sets `registrationState: 'ORPHANED'`, retains TSDB history).
  - `device.setSiteGroupSimulation({ siteGroupId, desired: boolean })` — bulk-toggle for the canvas-toolbar switch.
  - All mutations write audit rows under `AuditLog` action prefix `device.*`.

- **NEW CANVAS WIRING** `apps/web/components/canvas/canvas.tsx`:
  - On drop: after `nodeConfig.save`, call `device.create` and stash the returned `deviceKey` on the xyflow node's `data.deviceKey` field.
  - On node delete: call `device.delete` after confirming via dialog if `registrationState !== 'UNREGISTERED'`.
  - On node config edit (via existing `node-config-dialog.tsx`): call `device.update`.
  - SiteGroup-level toggle: new `<SimulationToggle />` button in the toolbar that calls `device.setSiteGroupSimulation`.

- **NEW STORE FIELDS** `apps/web/stores/canvas-store.ts`:
  - `nodeDevices: Map<canvasNodeId, DeviceRow>` — mirror of the Device rows for hot lookup; populated by `device.list` on canvas load, kept in sync via tRPC react-query invalidations on `device.*` mutations.

- **MODIFIED COMPONENT** `apps/web/components/canvas/nodes/device-node.tsx` (from spec 1):
  - Read `registrationState` from the matching Device row; render an "Unregistered" badge with a small dot animation while `UNREGISTERED`, a spinner while `REGISTERING`, none when `REGISTERED`.
  - Show `realUuid` in the hover tooltip when present; otherwise `deviceKey` truncated to 8 chars + `…`.

- **MODIFIED DASHBOARD WIDGETS** `apps/web/components/dashboard/widgets/*`:
  - Replace `{ siteId, topic }` binding with `{ deviceKey, metric }`.
  - Widget config dialog presents a typeahead over `device.list({ siteGroupId })` filtered to the same SiteGroup.
  - Backward-compat: existing widgets with `{ siteId, topic }` are migrated on first dashboard load by parsing the legacy topic (`modules/{groupId}/NDATA/{clientId}` → `device_key` lookup via `Gateway.clientId === clientId`). One-time, idempotent. A `dashboard-binding-migration` audit row is written.

- **MODIFIED SIMULATOR** `apps/simulator/src/manager.ts`:
  - `loadGateway` now resolves children via `Device` rows (`SELECT * FROM Device WHERE parentDeviceKey = $1 AND simulationDesired = true`) instead of reading `Gateway.sensors` JSONB.
  - `startGateway` honors `Device.config.signal` (per-Device override) falling back to manifest `defaultSignal`.
  - When `simulationDesired` flips false (e.g. after registration in spec 3), the per-Device publishing loop SHALL exit cleanly within 1 publishing interval.
  - Per-SiteGroup rate cap: aggregate publish rate across all Devices in a SiteGroup MUST NOT exceed 1,000 msg/s (the v1 budget); enforce via a token-bucket in the manager.

- **NEW SIMULATOR ENDPOINT** `apps/simulator/src/index.ts`:
  - `POST /sitegroups/:siteGroupId/simulation` body `{ desired: boolean }` — reconciles all Devices in the SiteGroup. Called by the canvas toolbar toggle.

- **NEW PRISMA MIGRATION** named `add-device-table-and-lifecycle` — adds `Device` table + enum, modifies `Gateway` (`deviceKey`, `simulationDesired`). Generated via `pnpm --filter @controlai-web/db prisma migrate dev`.

- **NEW TESTS**:
  - Unit (`packages/db`): migration script idempotency; sensor → Device row mapping correctness.
  - Unit (`packages/api`): `device.*` router — every CRUD + state-transition rule.
  - Integration: drop a node in the canvas → Device row materializes → simulator picks it up → SSE delivers messages.
  - UI: SiteGroup toggle flips simulation for all Devices; per-Device override remains independent.
  - Dashboard: legacy `{ siteId, topic }` widget migrates to `{ deviceKey, metric }` on load.

## Impact

- **Affected specs**: depends on `device-type-registry` (spec 1). NEW capability `device-lifecycle`.
- **Affected code**:
  - `packages/db/prisma/schema.prisma` — new `Device` model + enum; `Gateway` modified.
  - `packages/api/src/routers/device.ts` — NEW.
  - `packages/api/src/routers/nodeConfig.ts` — `save` triggers cascading `device.*` mutations for added/removed nodes.
  - `packages/api/src/routers/gateway.ts` — minor: reads `deviceKey` linkage when returning Gateway DTOs.
  - `packages/api/src/lib/apply-planner.ts` — broker node iteration now joins through Device → Site binding.
  - `apps/web/components/canvas/canvas.tsx`, `nodes/device-node.tsx`, `node-palette.tsx`, `apply-modal.tsx`.
  - `apps/web/components/dashboard/widgets/*` + `add-widget-dialog.tsx`.
  - `apps/simulator/src/manager.ts`, `boot-reconcile.ts`, `index.ts`.
  - `apps/web/stores/canvas-store.ts` — new `nodeDevices` map.
- **Affected user UX**:
  - Dropping a node now produces a row in the Devices view with an "Unregistered" badge.
  - Canvas toolbar gains a "Simulation: ON/OFF" toggle.
  - Dashboards continue to work transparently across the legacy-binding migration.
  - Detail tooltips show realUuid post-registration (spec 3 lights this up).
- **Non-goals**:
  - The actual UUID swap mechanism (spec 3).
  - Topic schema rewrite (spec 4).
  - Broker driver registry (spec 4).
  - Hard-delete vs soft-archive policy for *registered* devices in production (we soft-archive; the cleanup policy beyond that is out of scope).
- **Risk surface**:
  - Sensors-to-Devices migration is irreversible without a snapshot. Migration MUST be run with a one-time DB snapshot taken by ops; spec includes a runbook in `migration-checklist.md`.
  - Per-SiteGroup rate cap (1,000 msg/s) is new; existing live SiteGroups exceeding it MUST be flagged in pre-deploy review.

# Tasks: add-unregistered-device-lifecycle

Code-ready checklist. Depends on `add-plugin-device-type-registry` being applied. Order is mandatory.

## 1. Prisma schema + migration

- [x] 1.1 Edit `packages/db/prisma/schema.prisma`:
  - Add `enum DeviceRegistrationState { UNREGISTERED REGISTERING REGISTERED ORPHANED }`.
  - Add `model Device` with the columns from design §3 and the three indices `@@unique([siteGroupId, canvasNodeId])`, `@@index([siteGroupId, registrationState])`, `@@index([parentDeviceKey])`, `@@index([realUuid])`.
  - Add `deviceKey String? @unique` and `simulationDesired Boolean @default(false)` to `model Gateway`.
  - Add reverse relation `gateway Gateway?` on `Device` (one-to-one optional).
  - ~70 LOC delta.
- [x] 1.2 Run `pnpm --filter @controlai-web/db prisma migrate dev --name add-device-table-and-lifecycle` and commit the generated migration.
- [x] 1.3 Run `pnpm --filter @controlai-web/db prisma generate`.

## 2. Migration scripts

- [x] 2.1 Create `packages/db/scripts/migrate-sensors-to-devices.ts`:
  - Args: `--site-group <id>` (optional, defaults to all).
  - For each Gateway in scope, follow the §3.2 algorithm.
  - Idempotent: skip Gateway if `gateway.deviceKey` is set AND `Device.count({ parentDeviceKey: gateway.deviceKey }) === gateway.sensors.length`.
  - Writes `AuditLog` rows with action `device.migrated`, metadata `{ gatewayId, sensorCount, createdDeviceCount, skipped: boolean }`.
  - Exit codes: 0 success, 1 partial (some Gateways skipped due to data quality), 2 fatal.
  - ~250 LOC including a dry-run mode `--dry`.
- [x] 2.2 Create `packages/db/scripts/__tests__/migrate-sensors-to-devices.spec.ts`:
  - Seeded Gateway with 3 sensors → 4 Device rows (1 gateway + 3 sensors).
  - Re-running yields zero diff.
  - Gateway whose `clientId` matches a STM32 24-hex pattern is set `registrationState: 'REGISTERED'` and `realUuid: clientId`.
  - ~150 LOC.
- [x] 2.3 Create `packages/db/scripts/backfill-gateway-device-keys.ts` (subset of 2.1 for the rare case where a Gateway exists but has zero sensors). Idempotent. ~80 LOC.
- [x] 2.4 Add a `db:migrate-devices` script in `packages/db/package.json` calling the migration in non-dry mode. Document in `packages/db/README.md`.
- [x] 2.5 Add a startup gate in `apps/api/src/server.ts` (or equivalent): on boot, count Gateways where `deviceKey IS NULL`; if > 0 in production, log a fatal error and exit; in dev, log a warning. (Forces ops to run the migration before serving traffic with the new code.)
- [x] 2.6 Run the migration in staging, verify counts; verify no SiteGroup loses sensors visually on the canvas.
- [x] 2.7 **DEFERRED until next minor release**: drop `Gateway.sensors` JSONB column once all references in code are gone. (Tracked as a follow-up task; not part of this change's tasks.md completion.)

## 3. tRPC `device` router

- [x] 3.1 Create `packages/api/src/routers/device.ts` exporting `deviceRouter` per design §7. All procedures use `orgProcedure` (existing middleware) for org-scoped auth. ~400 LOC.
- [x] 3.2 Wire `deviceRouter` into `packages/api/src/root.ts` under `device`.
- [x] 3.3 Create `packages/api/src/routers/__tests__/device.spec.ts`:
  - Create: happy path; rejects unknown deviceTypeId; rejects parentDeviceKey not in same SiteGroup; rejects canvasNodeId collision.
  - Update: rejects `config` patch while `REGISTERED`; allows `simulationDesired` in all states; rejects `portBindings` while not `UNREGISTERED`.
  - Delete: hard-delete only when `UNREGISTERED`; soft-archive (sets `registrationState: 'ORPHANED'`) when `REGISTERED`.
  - List: filter combinations.
  - setSiteGroupSimulation: bulk updates correct rows; emits one `sim-toggle` HTTP POST to simulator; audit-log emitted.
  - ~500 LOC, ≥ 30 cases.

## 4. NodeConfig save → device.create wiring

- [x] 4.1 Modify `packages/api/src/routers/nodeConfig.ts`:
  - In `save`: after persistence, diff the previous version's nodes against the new version. For each NEW node, ensure a Device row exists (call `device.create` server-internal helper). For each REMOVED node, call `device.delete` (which soft-archives if registered).
  - Diff is by `canvasNodeId` (stable since spec 1 made deviceTypeId mandatory).
  - ~60 LOC delta.
- [x] 4.2 Extract `createDeviceInternal(args)` helper into `packages/api/src/lib/device-internal.ts` — same logic as the public `device.create` mutation but skips the user auth check (caller is the tRPC server in `nodeConfig.save`). ~50 LOC.
- [x] 4.3 Add tests in `nodeConfig.spec.ts` covering: save creates new Device rows; save removes Device rows for deleted nodes; save with no node-set diff produces zero device mutations. ~120 LOC.

## 5. Apply-planner: broker → Site binding via Device

- [x] 5.1 Modify `packages/api/src/lib/apply-planner.ts`:
  - When iterating broker nodes, resolve `node → Device → Site (via Device.siteId)` instead of `node → Site (via Site.canvasNodeId)`.
  - For backwards compat during migration: if `Device.siteId` is null but `Site.canvasNodeId === node.id` exists, treat that as the binding.
  - ~80 LOC delta.
- [x] 5.2 Apply commit path (`apply.ts commit`): after Site creation, set `Device.siteId` on the broker Device row and on all descendant Devices (`parentDeviceKey` chain).
- [x] 5.3 Tests in `apply-planner.spec.ts`: synthesis works with new binding; commit propagates `siteId` correctly.

## 6. Canvas store + canvas wiring

- [x] 6.1 Modify `apps/web/stores/canvas-store.ts`:
  - Add `nodeDevices: Map<string, DeviceRow>`.
  - Add actions `setNodeDevice`, `removeNodeDevice`, `bulkSetNodeDevices`.
  - Add selectors `getDeviceByCanvasNodeId`, `getDevicesBySimulationDesired`.
  - ~80 LOC delta.
- [x] 6.2 Modify `apps/web/components/canvas/canvas.tsx`:
  - On canvas load: call `api.device.list.useQuery({ siteGroupId })` and populate `nodeDevices` via `bulkSetNodeDevices`.
  - On drop: after `nodeConfig.save` mutation succeeds, call `api.device.create.useMutation` with `{ siteGroupId, canvasNodeId, deviceTypeId }`; stash the returned row via `setNodeDevice`.
  - On node delete: confirm via dialog if `nodeDevices.get(canvasNodeId)?.registrationState !== 'UNREGISTERED'`; then call `api.device.delete.useMutation`.
  - ~120 LOC delta.
- [x] 6.3 Create `apps/web/components/canvas/simulation-toggle.tsx`:
  - Compact toolbar button with on/off state derived from `useCanvasStore.getDevicesBySimulationDesired()`.
  - Calls `api.device.setSiteGroupSimulation.useMutation({ siteGroupId, desired })`.
  - Per-Device override badge (small dot) when at least one Device's `simulationDesired` differs from the SiteGroup aggregate.
  - ~90 LOC.
- [x] 6.4 Wire `<SimulationToggle />` into the canvas toolbar in `canvas.tsx`.
- [x] 6.5 Modify `apps/web/components/canvas/nodes/device-node.tsx`:
  - Read the matching Device row from `useCanvasStore.getDeviceByCanvasNodeId(nodeId)`.
  - Render the registration badge: small pill — `gray "Unregistered" + pulse` for UNREGISTERED, `amber "Registering…" + spinner` for REGISTERING, none for REGISTERED, `red "Orphaned"` for ORPHANED.
  - Render the identity sub-line: when REGISTERED, show `realUuid` truncated to first 12 chars + `…`; otherwise `deviceKey` truncated to 8 chars + `…`.
  - Mono-font for identifiers (already part of design system).
  - ~80 LOC delta.

## 7. Node config dialog: per-device override + lifecycle awareness

- [x] 7.1 Modify `apps/web/components/canvas/nodes/node-config-dialog.tsx`:
  - Header shows `registrationState` badge and the identity sub-line.
  - "Simulation" toggle bound to `Device.simulationDesired` via `api.device.update.useMutation`.
  - Config fields disabled when `registrationState !== 'UNREGISTERED'` with a tooltip linking to docs ("Config locked after registration; use ops portal").
  - ~120 LOC delta.

## 8. Dashboard widget binding migration

- [x] 8.1 Modify `packages/api/src/routers/dashboard.ts`:
  - `load` resolves legacy `binding` → `bindingV2` per design §6 on a per-widget basis; lookup via `Gateway.clientId`.
  - `save` accepts both fields; new writes set `bindingV2` only.
  - Server emits `AuditLog` rows action `dashboard.binding-migrated` when a resolution succeeds.
  - ~120 LOC delta.
- [x] 8.2 Modify every widget component under `apps/web/components/dashboard/widgets/*` to read `bindingV2` first, falling back to legacy `binding` only if `bindingV2` is null AND the legacy path can be resolved client-side (it cannot, in most cases — falls through to the "Binding migration needed" overlay).
  - `msg-rate-chart.tsx`, `status-board.tsx`, `last-n-messages.tsx`, `capacity-gauge.tsx`, `sensor-io-stream.tsx`.
  - ~30 LOC delta each.
- [x] 8.3 Modify `apps/web/components/dashboard/add-widget-dialog.tsx`:
  - Replace the topic-picker with a Device picker: typeahead over `api.device.list({ siteGroupId })` filtered to the active SiteGroup.
  - Second field: metric picker, populated from the selected Device's `deviceTypeId` manifest's `defaultSignal.units` + any extra metrics declared (future-proof).
  - On submit: emit `bindingV2: { deviceKey, metric }`.
  - ~140 LOC delta.
- [x] 8.4 Tests:
  - Server-side resolver migrates a legacy widget on `dashboard.load`.
  - Failed resolution leaves `bindingV2` null and the widget renders the migration overlay.
  - New-widget creation persists only `bindingV2`.
  - ~180 LOC.

## 9. Simulator reconciliation

- [x] 9.1 Modify `apps/simulator/src/manager.ts`:
  - Replace JSONB child loading with `prisma.device.findMany({ where: { siteGroupId, simulationDesired: true } })`.
  - Group by `parentDeviceKey`; produce gateway-runtime tasks.
  - Honor per-Device `config.signal` overrides falling back to manifest `defaultSignal`.
  - Reconciliation loop every 5s (configurable via env).
  - Fallback: if a Gateway has zero matching Device children but non-empty `Gateway.sensors[]`, log `sim-falling-back-to-jsonb` and use the JSONB path. This branch is removed in the follow-up release that drops the JSONB column (task 2.7).
  - ~180 LOC delta.
- [x] 9.2 Add per-SiteGroup token-bucket rate limiter:
  - `packages/shared/src/token-bucket.ts` exporting `class TokenBucket { capacity; refillPerSec; acquire(): Promise<void> }`.
  - `manager.ts` keeps `Map<siteGroupId, TokenBucket>` with capacity 1000, refill 1000/s.
  - Every NDATA publish awaits `bucket.acquire()`.
  - ~80 LOC including tests.
- [x] 9.3 Create `apps/simulator/src/routes/sitegroup-simulation.ts`:
  - `POST /sitegroups/:siteGroupId/simulation` body `{ desired: boolean }`.
  - On `desired: true`: trigger an immediate reconciliation pass.
  - On `desired: false`: stop all per-Device publishers in the SiteGroup within 1 second; do not exit the process.
  - Auth: same shared-secret header used by other simulator endpoints (`X-Sim-Token`).
  - ~80 LOC.
- [x] 9.4 Modify `apps/simulator/src/boot-reconcile.ts`:
  - Replace "load all Gateway rows with desiredState=running" with "load all Devices with simulationDesired=true and group by SiteGroup, then reconcile each."
  - ~30 LOC delta.
- [x] 9.5 Add `apps/simulator/src/lifecycle-listener.ts`:
  - Subscribe to DB changes (poll Device rows every 5s; or LISTEN/NOTIFY if available).
  - When `simulationDesired` flips false for a Device, halt its publisher within 1 publishing interval.
  - ~80 LOC.

## 10. mqtt-bridge: lastSeenAt write-through

- [x] 10.1 Modify `apps/mqtt-bridge/src/mqtt-manager.ts`:
  - On each decoded NDATA message, resolve `deviceKey` from the topic via existing `Gateway.clientId === clientId` lookup (transitional; spec 4 replaces this with native deviceKey in topic).
  - Throttle writes to once per 30s per `deviceKey` via in-memory `Map<deviceKey, lastWriteTs>`.
  - Write `UPDATE Device SET lastSeenAt = NOW() WHERE deviceKey = $1` via a fire-and-forget query (do not block the SSE fanout).
  - ~60 LOC delta.

## 11. UI: per-canvas device list view (read-only)

- [x] 11.1 Create `apps/web/app/(app)/orgs/[orgId]/projects/[projectId]/site-groups/[siteGroupId]/devices/page.tsx`:
  - Tab in the existing SiteGroup layout (alongside Canvas, Sites, Dashboard, Gateways).
  - Lists all Devices in the SiteGroup with columns: label, category, deviceTypeId, registrationState, realUuid (or shadowUuid), parent, lastSeenAt.
  - Filters: registrationState, deviceTypeId, parentDeviceKey.
  - Actions: open in canvas (focuses the matching xyflow node), per-Device simulation toggle.
  - ~250 LOC.
- [x] 11.2 Add the tab entry to the site-group layout file `app/(app)/orgs/.../site-groups/[siteGroupId]/layout.tsx`. ~10 LOC delta.

## 12. Reconciliation job (orphan detection)

- [x] 12.1 Create `packages/api/src/jobs/device-canvas-reconcile.ts`:
  - For each SiteGroup, fetch latest NodeConfig and Device rows.
  - Identify canvas nodes lacking Device rows and Device rows lacking canvas nodes (excluding ORPHANED rows).
  - Write `AuditLog` action `device.reconcile-mismatch` for each finding.
  - Schedule: every 60s in production; configurable via env.
  - ~120 LOC.
- [x] 12.2 Wire the job into the existing job scheduler (file: `packages/api/src/jobs/index.ts` if present; otherwise create a minimal scheduler using `setInterval` inside the apps/api server boot, behind an env flag `ENABLE_DEVICE_RECONCILE=true`).

## 13. Documentation + research refs

- [x] 13.1 Create `openspec/changes/add-unregistered-device-lifecycle/research-refs.md` linking to `.slash/workspace/research/identity-rewrite-and-provisioning.md`.
- [x] 13.2 Create `openspec/changes/add-unregistered-device-lifecycle/migration-checklist.md` (see template at the end of this tasks.md file's accompanying artifact).
- [x] 13.3 Update `apps/web/README.md` to describe the new Devices tab and SiteGroup simulation toggle.
- [x] 13.4 Update `packages/db/README.md` with the `db:migrate-devices` runbook.

## 14. Validation gate

- [x] 14.1 `pnpm -r typecheck` clean.
- [x] 14.2 `pnpm -r test` clean.
- [x] 14.3 `openspec validate add-unregistered-device-lifecycle --strict` clean.
- [x] 14.4 Staging dry-run: drop 5 sensors + 1 gateway in a fresh SiteGroup; verify Device rows materialize; toggle simulation off/on; verify SSE delivers messages keyed to the right Device.
- [x] 14.5 Staging migration: run `db:migrate-devices` against a snapshot of production; assert zero data loss in dashboards.

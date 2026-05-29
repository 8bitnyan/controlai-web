---
name: "Add unregistered-device lifecycle with first-class Device rows"
overview: "Apply OpenSpec change add-unregistered-device-lifecycle (spec 2 of 4). Introduces the Prisma `Device` model with immutable `deviceKey` CUID, `DeviceRegistrationState` enum, `Gateway.deviceKey` FK + `simulationDesired` flag, the `device.*` tRPC router, NodeConfig.save → device.create cascade, apply-planner Device→Site binding, a SiteGroup-level simulation toggle UI, dashboard widget binding migration (`{siteId,topic}` → `{deviceKey,metric}`), simulator reconciliation from Device rows + per-SiteGroup token-bucket cap, sensor-→Device migration scripts, a Devices tab, and an orphan reconciliation job. This is the foundation spec 4 depends on for routing topics + TSDB through `deviceKey`."
created: "2026-05-27T15:54:28Z"
last_updated: "2026-05-27T15:54:28Z"
isProject: false
type: "spec"
change_id: "add-unregistered-device-lifecycle"
plan_status: "draft"
trigger: "apply add-multi-broker-multi-ingest-and-identity-rewrite — sequenced as spec 2 of 4 prerequisites. User said: 'Starting with spec 1. Will chain through 1→2→3→4.' Spec 1 archived; this is spec 2."
todos:
  - id: t01-schema-prisma-device-model
    content: "Edit packages/db/prisma/schema.prisma: add DeviceRegistrationState enum, Device model with all columns + indices, Gateway.deviceKey String? @unique, Gateway.simulationDesired Boolean @default(false), reverse relation gateway Gateway? on Device"
    status: pending
  - id: t02-prisma-migration-generate
    content: "Run pnpm --filter @controlai-web/db prisma migrate dev --name add-device-table-and-lifecycle and pnpm --filter @controlai-web/db prisma generate; commit migration SQL"
    status: pending
  - id: t03-token-bucket-utility
    content: "Create packages/shared-types/src/token-bucket.ts exporting class TokenBucket { capacity; refillPerSec; acquire(): Promise<void> } with tests in __tests__/token-bucket.test.ts (capacity, refill cadence, queueing)"
    status: pending
  - id: t04-migration-script-tests
    content: "Write packages/db/scripts/__tests__/migrate-sensors-to-devices.spec.ts covering: 3-sensor gateway → 4 Device rows; idempotent re-run; STM32 24-hex clientId → REGISTERED + realUuid; PEM-missing gateway → UNREGISTERED"
    status: pending
  - id: t05-migration-script-impl
    content: "Implement packages/db/scripts/migrate-sensors-to-devices.ts (--site-group flag, --dry mode, per-Gateway idempotency check, AuditLog device.migrated rows, exit codes 0/1/2) per design §3.2"
    status: pending
  - id: t06-backfill-gateway-keys
    content: "Implement packages/db/scripts/backfill-gateway-device-keys.ts (idempotent, gateway-only case where sensors[] is empty) and add db:migrate-devices script to packages/db/package.json; update packages/db/README.md runbook"
    status: pending
  - id: t07-device-router-tests
    content: "Write packages/api/src/routers/__tests__/device.spec.ts (≥30 cases): create happy/unknown-deviceTypeId/parent-cross-sitegroup/canvasNodeId-collision; update config-locked-when-registered/portBindings-locked/simulationDesired-always; delete hard-vs-soft per state; list filter combos; setSiteGroupSimulation bulk + simulator POST + audit row"
    status: pending
  - id: t08-device-router-impl
    content: "Implement packages/api/src/routers/device.ts (list/get/create/update/delete/setSiteGroupSimulation on orgProcedure, Zod schemas per design §7, state-machine guards, AuditLog device.* writes via writeAudit, simulator HTTP POST in setSiteGroupSimulation) and wire into packages/api/src/root.ts under key `device`"
    status: pending
  - id: t09-create-device-internal-helper
    content: "Extract createDeviceInternal(args, db) into packages/api/src/lib/device-internal.ts (same logic as device.create mutation minus user-auth check; reused by nodeConfig.save). Add unit test exercising orphan-deviceTypeId + parent validation"
    status: pending
  - id: t10-nodeconfig-cascade-tests
    content: "Add tests in packages/api/src/routers/__tests__/nodeConfig.spec.ts covering: save creates Device rows for added nodes; save soft-deletes for removed registered nodes; save hard-deletes for removed UNREGISTERED nodes; save with no node diff produces zero device mutations"
    status: pending
  - id: t11-nodeconfig-cascade-impl
    content: "Modify packages/api/src/routers/nodeConfig.ts save: after persistence, diff previous nodes vs new by canvasNodeId; for ADDED nodes call createDeviceInternal; for REMOVED nodes call deleteDeviceInternal helper (hard if UNREGISTERED else soft-archive)"
    status: pending
  - id: t12-apply-planner-device-binding-tests
    content: "Extend packages/api/src/lib/__tests__/apply-planner.spec.ts: broker iteration resolves node → Device → Site via Device.siteId (preferred); falls back to legacy Site.canvasNodeId when Device.siteId null; apply commit propagates siteId to broker Device and descendants"
    status: pending
  - id: t13-apply-planner-device-binding-impl
    content: "Modify packages/api/src/lib/apply-planner.ts (broker→Site via Device.siteId with fallback) and packages/api/src/routers/apply.ts commit path (UPDATE Device SET siteId after Site creation, recurse via parentDeviceKey chain)"
    status: pending
  - id: t14-startup-gate
    content: "Add startup gate in apps/api boot (or packages/api server entry): on boot count Gateways where deviceKey IS NULL; in production log fatal + exit; in dev log warning. Gate behind env NODE_ENV"
    status: pending
  - id: t15-simulator-reconciliation-tests
    content: "Extend apps/simulator/src/__tests__/manager.test.ts: reconcileSiteGroup loads Devices via parentDeviceKey grouping; honors per-Device config.signal override; falls back to Gateway.sensors JSONB when zero Device children + logs sim-falling-back-to-jsonb; halts publisher within 1 interval when simulationDesired flips false"
    status: pending
  - id: t16-simulator-manager-impl
    content: "Modify apps/simulator/src/manager.ts: add reconcileSiteGroup(siteGroupId) calling prisma.device.findMany; group by parentDeviceKey; rewrite startGateway to consume Device children; honor config.signal override; preserve Gateway.sensors fallback branch with logger.warn; 5s reconciliation loop (configurable via SIM_RECONCILE_MS env)"
    status: pending
  - id: t17-simulator-rate-cap
    content: "Add per-SiteGroup TokenBucket map in apps/simulator/src/manager.ts (capacity 1000, refill 1000/s); every NDATA publish awaits bucket.acquire(); expose sim_rate_cap_delays_total{siteGroupId} counter; update manager tests to assert delay behavior"
    status: pending
  - id: t18-simulator-boot-reconcile
    content: "Modify apps/simulator/src/boot-reconcile.ts: replace Gateway desiredState query with Device-row-driven loader (group simulationDesired=true Devices by SiteGroup, call reconcileSiteGroup for each)"
    status: pending
  - id: t19-simulator-http-route
    content: "Create apps/simulator/src/routes/sitegroup-simulation.ts (Hono): POST /sitegroups/:siteGroupId/simulation body {desired:boolean}; on true trigger immediate reconcile; on false halt all publishers within 1s; X-Sim-Token shared-secret auth (mirror existing token pattern). Wire into apps/simulator/src/index.ts"
    status: pending
  - id: t20-simulator-lifecycle-listener
    content: "Create apps/simulator/src/lifecycle-listener.ts polling Device rows every 5s (or LISTEN/NOTIFY when DATABASE_URL is postgres native); when simulationDesired flips false halt publisher within 1 publishing interval. Add tests."
    status: pending
  - id: t21-mqtt-bridge-lastseen
    content: "Modify apps/mqtt-bridge/src/mqtt-manager.ts: on each decoded NDATA resolve deviceKey via Gateway.clientId === clientId lookup; throttle via in-memory Map<deviceKey, lastWriteTs> at 30s; fire-and-forget UPDATE Device SET lastSeenAt=NOW() WHERE deviceKey=$1 outside SSE fanout"
    status: pending
  - id: t22-dashboard-router-binding-migration
    content: "Modify packages/api/src/routers/dashboard.ts: load resolves legacy binding → bindingV2 per widget by parsing topic clientId then Gateway.clientId lookup; save accepts both fields, new writes use bindingV2 only; emit AuditLog dashboard.binding-migrated on resolve success. Add server tests for resolved + unresolvable + new-widget paths."
    status: pending
  - id: t23-dashboard-widgets-bindingV2
    content: "Modify all 5 widget components under apps/web/components/dashboard/widgets/* (msg-rate-chart, status-board, last-n-messages, capacity-gauge, sensor-io-stream): read bindingV2 first; legacy binding fall-through renders 'Binding migration needed — click to fix' overlay opening picker dialog"
    status: pending
  - id: t24-add-widget-dialog-device-picker
    content: "Rewrite apps/web/components/dashboard/add-widget-dialog.tsx: replace topic picker with Device picker typeahead over api.device.list({siteGroupId}); second field metric picker populated from selected Device's manifest defaultSignal; submit emits bindingV2:{deviceKey,metric}"
    status: pending
  - id: t25-canvas-store-augmentation
    content: "Modify apps/web/stores/canvas-store.ts: add nodeDevices Map<canvasNodeId, DeviceRow>; actions setNodeDevice, removeNodeDevice, bulkSetNodeDevices; selectors getDeviceByCanvasNodeId, getDevicesBySimulationDesired (compute aggregate). Add store tests."
    status: pending
  - id: t26-simulation-toggle-component
    content: "Create apps/web/components/canvas/simulation-toggle.tsx: compact toolbar button derived from useCanvasStore.getDevicesBySimulationDesired; calls api.device.setSiteGroupSimulation; renders amber divergence dot when at least one Device's flag differs from group aggregate"
    status: pending
  - id: t27-canvas-wiring
    content: "Modify apps/web/components/canvas/canvas.tsx: on canvas load call api.device.list useQuery and bulkSetNodeDevices; on drop after nodeConfig.save call api.device.create stashing returned row via setNodeDevice; on node delete confirm-dialog when registrationState!==UNREGISTERED then api.device.delete; mount <SimulationToggle /> in toolbar"
    status: pending
  - id: t28-device-node-badge
    content: "Modify apps/web/components/canvas/nodes/device-node.tsx: read Device row via useCanvasStore.getDeviceByCanvasNodeId; render registration badge per state (gray pulse UNREGISTERED, amber spinner REGISTERING, none REGISTERED, red ORPHANED); identity sub-line: realUuid truncated 12 chars when REGISTERED else deviceKey truncated 8 chars; mono font"
    status: pending
  - id: t29-node-config-dialog-lifecycle
    content: "Modify apps/web/components/canvas/nodes/node-config-dialog.tsx: header shows registrationState badge + identity sub-line; simulation toggle bound to Device.simulationDesired via api.device.update; config fields disabled when registrationState!==UNREGISTERED with tooltip linking docs"
    status: pending
  - id: t30-devices-tab-page
    content: "Create apps/web/app/(app)/orgs/[orgId]/projects/[projectId]/site-groups/[siteGroupId]/devices/page.tsx + add 'Devices' tab to layout.tsx; columns label/category/deviceTypeId/registrationState/realUuid|shadowUuid/parent/lastSeenAt; filters registrationState/deviceTypeId/parentDeviceKey; actions open-in-canvas + per-Device simulation toggle"
    status: pending
  - id: t31-reconciliation-job
    content: "Create packages/api/src/jobs/device-canvas-reconcile.ts (60s interval, env flag ENABLE_DEVICE_RECONCILE=true): for each SiteGroup find canvas nodes lacking Device rows + Device rows lacking canvas nodes (exclude ORPHANED); write AuditLog action device.reconcile-mismatch. Wire scheduler in apps/api server boot."
    status: pending
  - id: t32-docs-updates
    content: "Update apps/web/README.md (Devices tab + SiteGroup simulation toggle) and packages/db/README.md (db:migrate-devices runbook). research-refs.md and migration-checklist.md already exist in spec — skip."
    status: pending
  - id: t33-validation-gate
    content: "Run pnpm -r typecheck, pnpm -r test, pnpm openspec validate add-unregistered-device-lifecycle --strict; all clean. Capture any deviations in plan notes."
    status: pending
---

# Plan: Add unregistered-device lifecycle with first-class Device rows

## Background & Research

### Spec sequence position

- This is **spec 2 of 4** in the chain: `add-plugin-device-type-registry` (✅ archived) → **`add-unregistered-device-lifecycle`** (this plan) → `extend-gateway-register-handshake` → `add-multi-broker-multi-ingest-and-identity-rewrite`.
- Spec 4 explicitly requires `Device` model and `Gateway.deviceKey` to exist; this plan delivers both.
- Spec 1 artifacts already live: `getDeviceType`, `assertKnownDeviceType`, manifest registry under `packages/shared-types/src/device-types/`.

### Saved research (read by coders as needed)

- `openspec/changes/add-unregistered-device-lifecycle/research-refs.md` — saved research on AWS IoT JITP, Azure DPS, ThingsBoard claim flow; recommends stable surrogate (`device_key`) with alias-table holding `shadowUuid` + `realUuid`. **No new researcher run required** — refs file already complete.

### Current Gateway model (the one we extend)

`packages/db/prisma/schema.prisma` lines 297-324:
```prisma
model Gateway {
  id                  String    @id @default(cuid())
  siteGroupId         String
  siteGroup           SiteGroup @relation(fields: [siteGroupId], references: [id], onDelete: Cascade)
  label               String
  kind                String    // 'simulator' | 'physical'
  mode                String    // 'cbor-modules-cloud' | 'json'
  endpointURL         String
  tlsServername       String?
  brokerHost          String?
  brokerPort          Int?
  groupId             String    // modules_cloud GROUP_ID — used as CN in cert and topic segment
  clientId            String    // MQTT client id — for cbor mode this is also EDGE_NODE_ID
  rootCaPemEnc        String
  clientCertPemEnc    String
  clientKeyPemEnc     String
  sensors             Json      // [{id, type, min, max, walkStep, intervalMs, unit?, seed?}]
  jsonTopicTemplate   String?
  desiredState        String    @default("stopped")
  lastStatus          String    @default("stopped")
  lastError           String?
  lastProvisionedDeviceSerial String?
  lastProvisionedAt   DateTime?
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
  @@index([siteGroupId])
}
```

### Schema additions for this spec (paste into schema.prisma)

```prisma
enum DeviceRegistrationState {
  UNREGISTERED
  REGISTERING
  REGISTERED
  ORPHANED
}

model Device {
  deviceKey           String   @id @default(cuid())
  siteGroupId         String
  siteGroup           SiteGroup @relation(fields: [siteGroupId], references: [id], onDelete: Cascade)
  canvasNodeId        String
  siteId              String?
  site                Site?    @relation(fields: [siteId], references: [id], onDelete: SetNull)
  deviceTypeId        String
  registrationState   DeviceRegistrationState @default(UNREGISTERED)
  shadowUuid          String
  realUuid            String?
  parentDeviceKey     String?
  parent              Device?  @relation("DeviceParent", fields: [parentDeviceKey], references: [deviceKey], onDelete: SetNull)
  children            Device[] @relation("DeviceParent")
  portBindings        Json?
  config              Json     @default("{}")
  simulationDesired   Boolean  @default(true)
  registeredAt        DateTime?
  registeredByUserId  String?
  lastSeenAt          DateTime?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  gateway             Gateway?

  @@unique([siteGroupId, canvasNodeId])
  @@index([siteGroupId, registrationState])
  @@index([parentDeviceKey])
  @@index([realUuid])
}

// Modifications to model Gateway:
//   deviceKey          String?  @unique
//   device             Device?  @relation(fields: [deviceKey], references: [deviceKey], onDelete: SetNull)
//   simulationDesired  Boolean  @default(false)
```

### tRPC infra (the patterns to mirror)

`packages/api/src/trpc.ts` lines 88: `export const orgProcedure = t.procedure.use(isOrgMember);` — middleware reads `orgId` from input, verifies membership, sets `ctx.orgId`, `ctx.orgRole`. All `device.*` procedures use `orgProcedure`.

`packages/api/src/lib/audit-writer.ts`:
```ts
export interface WriteAuditInput {
  orgId: string;
  userId?: string | null;
  action: string;
  targetId?: string | null;
  targetType?: string | null;
  metadata?: Record<string, unknown> | null;
}
export async function writeAudit(db: PrismaClient, input: WriteAuditInput): Promise<void> { /* fire-and-forget */ }
```
Use this for **every** `device.*` mutation (`device.create`, `device.update`, `device.delete-hard`, `device.soft-archive`, `device.bulk-simulation-toggle`, `device.migrated`, `device.reconcile-mismatch`, `dashboard.binding-migrated`).

`packages/api/src/routers/nodeConfig.ts` lines 58-122 — `save` mutation: deviceTypeId validation (lines 73-87) via `assertKnownDeviceType` already wired (from spec 1). Post-persistence diff/cascade hook lands at line 122 (after `update`/`create` return). Pattern:

```ts
const previousNodes = latest ? (latest.nodes as unknown as Array<{id: string; data?: {deviceTypeId?: string}}>) : [];
const newNodes      = input.nodes as Array<{id: string; data?: {deviceTypeId?: string}}>;
const prevIds = new Set(previousNodes.map(n => n.id));
const newIds  = new Set(newNodes.map(n => n.id));
const added   = newNodes.filter(n => !prevIds.has(n.id));
const removed = previousNodes.filter(n => !newIds.has(n.id));
for (const node of added)   await createDeviceInternal({ ... }, ctx.prisma);
for (const node of removed) await deleteDeviceInternal({ deviceKey, db: ctx.prisma });
```

### Simulator current Gateway loader (the path we replace)

`apps/simulator/src/manager.ts` lines 66-94:
```ts
async function loadGateway(gatewayId: string) {
  const row = await prisma.gateway.findUniqueOrThrow({ where: { id: gatewayId } });
  return {
    /* ...spreads gateway columns... */
    sensors: row.sensors as unknown as SensorConfig[],
    /* ... */
  };
}
```
Line 114: `const sensors = (gw.sensors as SensorConfig[]).map((sensor) => resolveSensorRuntime(sensor));`

Replace with Device-row query:
```ts
async function loadGatewayChildren(deviceKey: string, siteGroupId: string): Promise<DeviceRow[]> {
  return prisma.device.findMany({
    where: { siteGroupId, parentDeviceKey: deviceKey, simulationDesired: true },
  });
}
```
Fallback: if zero results AND `gateway.sensors[]` non-empty → log `{ event: 'sim-falling-back-to-jsonb', gatewayId }` and use JSONB. Branch removed in spec 2.7 follow-up release.

### tRPC client invocation pattern (canvas.tsx)

Pattern observed in `apps/web/components/canvas/canvas.tsx`:
```ts
const saveNodeConfig = trpc.nodeConfig.save.useMutation();
saveNodeConfig.mutate({ orgId, siteGroupId, nodes, edges });
```
Use the same `trpc.device.*.useMutation/useQuery` style for all device-router calls.

### TokenBucket location

Spec text says `packages/shared/src/token-bucket.ts`; project has **`packages/shared-types`** (no `packages/shared`). **Deviation**: place token-bucket under `packages/shared-types/src/token-bucket.ts` and export from `packages/shared-types/src/index.ts`. Import as `import { TokenBucket } from '@controlai-web/shared-types';`. Document in t03 + t33 plan notes.

### Existing Site model (for Device.siteId FK)

`packages/db/prisma/schema.prisma` lines 207-229: `model Site { id String @id @default(cuid()) ... canvasNodeId String? ... }`. The `Device.siteId` FK is nullable (SetNull on delete) so Device rows survive Site deletion as ORPHANED candidates.

### Existing dashboard widgets to migrate

Confirmed file list under `apps/web/components/dashboard/widgets/`:
1. `msg-rate-chart.tsx`
2. `status-board.tsx`
3. `last-n-messages.tsx`
4. `capacity-gauge.tsx`
5. `sensor-io-stream.tsx`

All currently consume `binding: { siteId, topic }` (some derive props via store; status-board derives from canvas store). They get a `bindingV2: { deviceKey, metric }` read-path with fallback to the migration overlay.

### Site-group layout tabs (for Devices tab insertion)

`apps/web/app/(app)/orgs/[orgId]/projects/[projectId]/site-groups/[siteGroupId]/layout.tsx` lines 16-21 has the tab definition array (Canvas, Sites, Dashboard, Gateways). Append a `{ key: 'devices', label: 'Devices', href: 'devices' }` entry; create `devices/page.tsx`.

## Testing Plan

Strict TDD — every test task lands BEFORE its matching implementation task. Vitest is the harness across all packages (config already added per spec 1 in shared-types and simulator).

- [ ] `t03-token-bucket-utility`: write + green tests for TokenBucket capacity, refillPerSec cadence, queueing under contention; same file delivers both red tests and impl in one atomic commit (utility is small).
- [ ] `t04-migration-script-tests`: red tests for `migrate-sensors-to-devices.ts` covering 4-row materialization, idempotency, STM32-hex → REGISTERED+realUuid, missing-PEM → UNREGISTERED.
- [ ] `t07-device-router-tests`: red tests for `device.*` router (≥30 cases) per task §3.3 of spec.
- [ ] `t10-nodeconfig-cascade-tests`: red tests in `nodeConfig.spec.ts` for create-on-add, delete-on-remove (hard vs soft per registrationState), no-op on no-diff.
- [ ] `t12-apply-planner-device-binding-tests`: red tests for broker → Device.siteId preferred binding + legacy fallback + commit propagation through parentDeviceKey chain.
- [ ] `t15-simulator-reconciliation-tests`: red tests for `reconcileSiteGroup` Device loader, per-Device override, JSONB fallback log emission, publisher halt within 1 interval on flip.
- [ ] `t17-simulator-rate-cap`: tests assert delay (not drop) behavior under bucket starvation; counter increments monotonically.
- [ ] `t20-simulator-lifecycle-listener`: red tests for poll loop + halt-on-flip.
- [ ] `t22-dashboard-router-binding-migration`: server-side tests for resolved migration, unresolvable widget (bindingV2 stays null), new-widget creation persists only bindingV2.
- [ ] `t25-canvas-store-augmentation`: store-level tests for nodeDevices map + selectors (especially `getDevicesBySimulationDesired` aggregate divergence semantics).
- [ ] `t33-validation-gate`: full `pnpm -r typecheck`, `pnpm -r test`, `pnpm openspec validate add-unregistered-device-lifecycle --strict` — the final green gate.

UI rendering (badge states, dialog disabled fields, overlay click) are validated via the staging dry-run step in spec task 14.4; no Playwright tasks in this plan.

## Implementation Plan

Strict TDD order. Each `t##` matches a `todos[].id` in frontmatter.

### Phase A — Schema foundation (sequential, blocking everything else)
- [ ] `t01-schema-prisma-device-model`: edit `packages/db/prisma/schema.prisma` (Device + enum + Gateway deltas + relations + 4 indices).
- [ ] `t02-prisma-migration-generate`: generate migration `add-device-table-and-lifecycle` + `prisma generate`; commit SQL.

### Phase B — Utilities + migration scripts (parallel after Phase A)
- [ ] `t03-token-bucket-utility`: `packages/shared-types/src/token-bucket.ts` + tests; export from shared-types index. Note: **deviation** from spec text (`packages/shared/`) recorded in Background §"TokenBucket location".
- [ ] `t04-migration-script-tests`: red tests in `packages/db/scripts/__tests__/migrate-sensors-to-devices.spec.ts`.
- [ ] `t05-migration-script-impl`: implement `packages/db/scripts/migrate-sensors-to-devices.ts` (with `--dry`, `--site-group`, exit codes, audit rows). Make t04 tests green.
- [ ] `t06-backfill-gateway-keys`: implement `packages/db/scripts/backfill-gateway-device-keys.ts` + `db:migrate-devices` script in `packages/db/package.json` + README runbook section.

### Phase C — Device router (sequential within: tests → impl → helper)
- [ ] `t07-device-router-tests`: red tests in `packages/api/src/routers/__tests__/device.spec.ts` (≥30 cases per spec).
- [ ] `t08-device-router-impl`: `packages/api/src/routers/device.ts` + wire into `packages/api/src/root.ts`. Make t07 green.
- [ ] `t09-create-device-internal-helper`: `packages/api/src/lib/device-internal.ts` exporting `createDeviceInternal`, `deleteDeviceInternal`. Used by t11.

### Phase D — API integration (parallel after Phase C)
- [ ] `t10-nodeconfig-cascade-tests`: red tests in `packages/api/src/routers/__tests__/nodeConfig.spec.ts`.
- [ ] `t11-nodeconfig-cascade-impl`: modify `packages/api/src/routers/nodeConfig.ts` save cascade. Make t10 green.
- [ ] `t12-apply-planner-device-binding-tests`: extend `packages/api/src/lib/__tests__/apply-planner.spec.ts`.
- [ ] `t13-apply-planner-device-binding-impl`: modify `packages/api/src/lib/apply-planner.ts` + `packages/api/src/routers/apply.ts` commit path. Make t12 green.
- [ ] `t14-startup-gate`: add prod-fatal / dev-warn boot check in apps/api server entry.

### Phase E — Simulator + mqtt-bridge (parallel after Phase A/B; can run alongside Phase C/D)
- [ ] `t15-simulator-reconciliation-tests`: red tests in `apps/simulator/src/__tests__/manager.test.ts`.
- [ ] `t16-simulator-manager-impl`: rewrite `apps/simulator/src/manager.ts` reconcileSiteGroup + Device child loader + fallback path. Make t15 green.
- [ ] `t17-simulator-rate-cap`: integrate per-SiteGroup TokenBucket into manager publish path + counter. Tests in same file as t15.
- [ ] `t18-simulator-boot-reconcile`: rewrite `apps/simulator/src/boot-reconcile.ts` to drive from Device rows.
- [ ] `t19-simulator-http-route`: `apps/simulator/src/routes/sitegroup-simulation.ts` + wire in `apps/simulator/src/index.ts`.
- [ ] `t20-simulator-lifecycle-listener`: `apps/simulator/src/lifecycle-listener.ts` + tests.
- [ ] `t21-mqtt-bridge-lastseen`: modify `apps/mqtt-bridge/src/mqtt-manager.ts` for throttled lastSeenAt write-through.

### Phase F — Dashboard (sequential: server router first, then UI widgets + dialog)
- [ ] `t22-dashboard-router-binding-migration`: modify `packages/api/src/routers/dashboard.ts` + server tests.
- [ ] `t23-dashboard-widgets-bindingV2`: modify all 5 widget components to read bindingV2 first + render overlay on null.
- [ ] `t24-add-widget-dialog-device-picker`: rewrite `apps/web/components/dashboard/add-widget-dialog.tsx` to Device + metric picker.

### Phase G — Canvas UI (parallel by file)
- [ ] `t25-canvas-store-augmentation`: modify `apps/web/stores/canvas-store.ts` + store tests.
- [ ] `t26-simulation-toggle-component`: new `apps/web/components/canvas/simulation-toggle.tsx`.
- [ ] `t27-canvas-wiring`: modify `apps/web/components/canvas/canvas.tsx` (load+drop+delete+toolbar mount).
- [ ] `t28-device-node-badge`: modify `apps/web/components/canvas/nodes/device-node.tsx`.
- [ ] `t29-node-config-dialog-lifecycle`: modify `apps/web/components/canvas/nodes/node-config-dialog.tsx`.

### Phase H — New surfaces (parallel)
- [ ] `t30-devices-tab-page`: new `apps/web/app/(app)/orgs/[orgId]/projects/[projectId]/site-groups/[siteGroupId]/devices/page.tsx` + tab entry in `layout.tsx`.
- [ ] `t31-reconciliation-job`: new `packages/api/src/jobs/device-canvas-reconcile.ts` + scheduler wire in apps/api boot under `ENABLE_DEVICE_RECONCILE=true`.

### Phase I — Docs + final gate (sequential at the end)
- [ ] `t32-docs-updates`: append Devices-tab + simulation-toggle docs to `apps/web/README.md`; append migration runbook section to `packages/db/README.md`.
- [ ] `t33-validation-gate`: `pnpm -r typecheck`, `pnpm -r test`, `pnpm openspec validate add-unregistered-device-lifecycle --strict`. Mark plan_status: done.

## Delegation Notes

### Batch 0 — Schema (1 coder, sequential, BLOCKING)
- [ ] Coder A: `t01-schema-prisma-device-model`, `t02-prisma-migration-generate` → files: `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/*` (generated)

### Batch 1 — Utilities + migration scripts + early tests (parallel, 4 coders, after Batch 0)
- [ ] Coder B: `t03-token-bucket-utility` → files: `packages/shared-types/src/token-bucket.ts`, `packages/shared-types/src/__tests__/token-bucket.test.ts`, `packages/shared-types/src/index.ts` (add export line only)
- [ ] Coder C: `t04-migration-script-tests` + `t05-migration-script-impl` + `t06-backfill-gateway-keys` → files: `packages/db/scripts/migrate-sensors-to-devices.ts`, `packages/db/scripts/__tests__/migrate-sensors-to-devices.spec.ts`, `packages/db/scripts/backfill-gateway-device-keys.ts`, `packages/db/package.json`, `packages/db/README.md`
- [ ] Coder D: `t07-device-router-tests` → file: `packages/api/src/routers/__tests__/device.spec.ts` (test fixtures may live next to the file)
- [ ] Coder E: `t12-apply-planner-device-binding-tests` + `t15-simulator-reconciliation-tests` (test-only edits to existing spec files) → files: `packages/api/src/lib/__tests__/apply-planner.spec.ts`, `apps/simulator/src/__tests__/manager.test.ts`

### Batch 2 — Device router impl + helper (sequential 2 coders, after Batch 1)
- [ ] Coder F: `t08-device-router-impl` + `t09-create-device-internal-helper` → files: `packages/api/src/routers/device.ts`, `packages/api/src/lib/device-internal.ts`, `packages/api/src/root.ts`

### Batch 3 — API integration + apply-planner + startup gate (parallel 3 coders, after Batch 2)
- [ ] Coder G: `t10-nodeconfig-cascade-tests` + `t11-nodeconfig-cascade-impl` → files: `packages/api/src/routers/nodeConfig.ts`, `packages/api/src/routers/__tests__/nodeConfig.spec.ts`
- [ ] Coder H: `t13-apply-planner-device-binding-impl` → files: `packages/api/src/lib/apply-planner.ts`, `packages/api/src/routers/apply.ts`
- [ ] Coder I: `t14-startup-gate` → files: `apps/api/src/server.ts` (or whichever boot entry exists; coder verifies path before edit)

### Batch 4 — Simulator + mqtt-bridge (parallel 4 coders, can run alongside Batch 2/3 since file boundaries are disjoint)
- [ ] Coder J: `t16-simulator-manager-impl` + `t17-simulator-rate-cap` + `t18-simulator-boot-reconcile` → files: `apps/simulator/src/manager.ts`, `apps/simulator/src/boot-reconcile.ts`
- [ ] Coder K: `t19-simulator-http-route` → files: `apps/simulator/src/routes/sitegroup-simulation.ts`, `apps/simulator/src/index.ts`
- [ ] Coder L: `t20-simulator-lifecycle-listener` → files: `apps/simulator/src/lifecycle-listener.ts`, `apps/simulator/src/__tests__/lifecycle-listener.test.ts`
- [ ] Coder M: `t21-mqtt-bridge-lastseen` → files: `apps/mqtt-bridge/src/mqtt-manager.ts`

### Batch 5 — Dashboard server + UI (sequential within: M's router lands first, then 5a/5b split by file)
- [ ] Coder N: `t22-dashboard-router-binding-migration` → files: `packages/api/src/routers/dashboard.ts`, `packages/api/src/routers/__tests__/dashboard.spec.ts`
- [ ] Coder O: `t23-dashboard-widgets-bindingV2` → files: `apps/web/components/dashboard/widgets/{msg-rate-chart,status-board,last-n-messages,capacity-gauge,sensor-io-stream}.tsx`
- [ ] Coder P: `t24-add-widget-dialog-device-picker` → file: `apps/web/components/dashboard/add-widget-dialog.tsx`

### Batch 6 — Canvas UI (parallel 5 coders by file boundary, after Batch 2 ships the device router for client types)
- [ ] Coder Q: `t25-canvas-store-augmentation` → files: `apps/web/stores/canvas-store.ts`, `apps/web/stores/__tests__/canvas-store.test.ts`
- [ ] Coder R: `t26-simulation-toggle-component` → file: `apps/web/components/canvas/simulation-toggle.tsx`
- [ ] Coder S: `t27-canvas-wiring` → file: `apps/web/components/canvas/canvas.tsx`
- [ ] Coder T: `t28-device-node-badge` → file: `apps/web/components/canvas/nodes/device-node.tsx`
- [ ] Coder U: `t29-node-config-dialog-lifecycle` → file: `apps/web/components/canvas/nodes/node-config-dialog.tsx`

### Batch 7 — New surfaces (parallel 2 coders, after Batch 2)
- [ ] Coder V: `t30-devices-tab-page` → files: `apps/web/app/(app)/orgs/[orgId]/projects/[projectId]/site-groups/[siteGroupId]/devices/page.tsx`, `apps/web/app/(app)/orgs/[orgId]/projects/[projectId]/site-groups/[siteGroupId]/layout.tsx`
- [ ] Coder W: `t31-reconciliation-job` → files: `packages/api/src/jobs/device-canvas-reconcile.ts`, `packages/api/src/jobs/index.ts` (create if absent), apps/api boot wire

### Batch 8 — Docs + final validation gate (sequential, 1 coder, ABSOLUTELY LAST)
- [ ] Coder X: `t32-docs-updates` + `t33-validation-gate` → files: `apps/web/README.md`, `packages/db/README.md`; then run typecheck + tests + openspec validate

### Dependencies

```
Batch 0 (schema) ──► everything else
                  ├─► Batch 1 (utilities, migration, test-only edits)
                  ├─► Batch 2 (device router) ──► Batch 3 (API integ.)
                  │                            └─► Batch 6 (canvas UI)
                  │                            └─► Batch 7 (new surfaces)
                  ├─► Batch 4 (simulator + mqtt-bridge)
                  └─► Batch 5 (dashboard) ──┐
                                            └─► (no hard order to Batch 6/7)
                                            
All Batches 1-7 ──► Batch 8 (docs + validation gate)
```

- Batch 2 must complete before Batch 3 (nodeConfig.save needs createDeviceInternal), Batch 6 (web client needs typed device router), Batch 7 (Devices page needs device.list query).
- Batch 4 can run anywhere after Batch 0; no shared files with Batches 2/3/5/6/7.
- Batch 5 router (Coder N) must complete before widgets read `bindingV2` from a known schema, but widget read-path is permissive (null → overlay) so 5a+5b can also start in parallel after Batch 2 if coders agree the bindingV2 shape upfront (it is locked by spec).

### Risk Areas

1. **Schema drift between Coder A and downstream coders.** Mitigation: Coder A commits schema + migration first; everyone else pulls before starting. Communicate Device field names verbatim (snake-free) — design block above is the source of truth.
2. **TokenBucket location deviation (`packages/shared` vs `packages/shared-types`).** Mitigation: t03 explicitly places in shared-types; t17 imports from shared-types; t33 captures deviation note.
3. **NodeConfig.save cascade ordering.** Risk: device.create for an ADDED node fires before the new NodeConfig row commits, so the FK / consistency could race. Mitigation: cascade runs **after** `prisma.nodeConfig.create/update` returns (Coder G inserts cascade logic after the existing return statement — note: this means the save mutation must change from `return ctx.prisma.nodeConfig.create({...})` to assigning to a local then doing cascade then returning).
4. **Dashboard widget bindingV2 vs legacy `binding` shape collisions.** Mitigation: server (t22) emits BOTH fields during the migration window; widgets prefer bindingV2; failed resolves leave bindingV2 null and surface overlay. Legacy field stays in schema (no DB migration here).
5. **Per-SiteGroup rate cap regressions on existing live SiteGroups.** Mitigation: migration-checklist.md (already exists in spec) instructs ops to pre-identify over-cap SiteGroups; cap delays (does not drop) so behavior degrades gracefully.
6. **`Gateway.sensors` JSONB fallback in simulator** — must remain through this spec deploy; spec task 2.7 (drop column) is explicitly **deferred** to the next minor release. t16 keeps the fallback branch with a warn log.
7. **createDeviceInternal recursion guard.** When nodeConfig.save iterates ADDED nodes, sensor nodes might be added before their parent gateway in the same payload. Mitigation: Coder G sorts ADDED by absence of `parentDeviceKey` first, then parents-before-children; relies on canvas drop order. If validation fails (parent not yet present), defer and retry within the same loop pass.

## Done Criteria

- [ ] All `todos` in frontmatter are `status: done` and matching body checklists are `[x]`.
- [ ] `pnpm -r typecheck` clean (t33).
- [ ] `pnpm -r test` clean across packages/db, packages/api, packages/shared-types, apps/simulator, apps/mqtt-bridge, apps/web (t33).
- [ ] `pnpm openspec validate add-unregistered-device-lifecycle --strict` clean (t33).
- [ ] OpenSpec tasks `tasks.md` items 1.1 → 14.5 all flipped to `[x]` (matches plan todos t01–t33 collectively); deferred items (2.6 staging dry-run, 2.7 column drop, 14.4/14.5 staging) marked per spec text as out-of-CI / deferred.
- [ ] `Device` model + `Gateway.deviceKey` exist in `packages/db/prisma/schema.prisma` (precondition for spec 3 / spec 4 chain).
- [ ] Plan `plan_status` flipped to `done`.

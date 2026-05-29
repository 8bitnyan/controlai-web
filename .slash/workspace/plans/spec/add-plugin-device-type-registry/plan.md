---
name: "Plugin-style device-type registry"
overview: "Implement a manifest-driven, in-process device-type registry in `@controlai-web/shared-types` and rewire all consumers (canvas palette, canvas validator, node renderers, canvas store, server-side nodeConfig router, apply-planner, simulator). Replaces the hardcoded six-type Zod discriminated union and the static `CONNECTION_MATRIX` constant with `registerDeviceType()` + `validateConnection()`. Ships six core/generic-* legacy-compat manifests plus the first two DAEJAK device manifests (`daejak-main-v1`, `daejak-vm`). Adds orphan-type UI, palette tabs/search/recently-used, on-read NodeConfig migration from legacy `type` to `deviceTypeId`, and a contract test that enforces aggregator exhaustiveness. This is spec 1 of a 4-spec sequence — specs 2/3/4 (unregistered-device-lifecycle, register-handshake, multi-broker-multi-ingest) all depend on the manifest catalog landing first."
created: "2026-05-27T14:52:36Z"
last_updated: "2026-05-27T14:52:36Z"
isProject: false
type: "spec"
change_id: "add-plugin-device-type-registry"
plan_status: "draft"
trigger: "apply add-plugin-device-type-registry (spec #1 of 4 in the multi-broker-multi-ingest-and-identity-rewrite chain — mad-agent sequenced)"
todos:
  - id: t01-test-harness-shared-types
    content: "Add vitest test harness to packages/shared-types (config + script + devDep) so the new device-types tests can run via `pnpm --filter @controlai-web/shared-types test`."
    status: pending
  - id: t02-tests-schema-port-protocol
    content: "Write failing Vitest tests for schema.ts / port-types.ts / protocol-families.ts (Zod parse happy + category refinements + invalid accent + duplicate port-type cases) BEFORE implementation."
    status: pending
  - id: t03-impl-schema-port-protocol
    content: "Implement port-types.ts, protocol-families.ts, schema.ts (Category, DevicePortSchema, DefaultSignalSchema, DeviceTypeSchema + superRefine category rules) until tests in t02 pass."
    status: pending
  - id: t04-tests-registry-runtime
    content: "Write failing tests for registry.ts (register/get/list/assertKnown/validateConnection — capacity, protocol mismatch, unknown ids, duplicate-id with call site, listDeviceTypes filter) and default-data.ts."
    status: pending
  - id: t05-impl-registry-runtime
    content: "Implement registry.ts (Map + duplicate-id Error with caller stack), default-data.ts (manifest → NodeData seed), validateConnection() with the four ordered checks from the spec until tests in t04 pass."
    status: pending
  - id: t06-tests-manifests-core-daejak
    content: "Write failing snapshot + per-manifest contract tests for core/* (6 files) and daejak/* (daejak-main-v1, daejak-vm) — assert each registers exactly once, snapshot the parsed manifest shape."
    status: pending
  - id: t07-impl-manifests-core-daejak
    content: "Implement the six core legacy-compat manifests (`core-generic-{sensor,gateway,broker,ingest,tsdb,monitoring}`) and the two DAEJAK manifests (`daejak-main-v1`, `daejak-vm`) per design §3.3, until t06 passes."
    status: pending
  - id: t08-tests-aggregator-contract
    content: "Write failing aggregator contract test: enumerate manifests/**/*.ts via `node:fs`; assert each path appears as side-effect import in index.ts; assert listDeviceTypes() count == discovered count."
    status: pending
  - id: t09-impl-aggregator-and-package-index
    content: "Implement device-types/index.ts side-effect aggregator; extend packages/shared-types/src/index.ts to re-export ./device-types (preserve existing exports untouched). Aggregator test in t08 passes."
    status: pending
  - id: t10-tests-nodeconfig-router
    content: "Add failing tests in packages/api/src/__tests__/nodeConfig.test.ts: save rejects unknown deviceTypeId with TRPCError BAD_REQUEST; load augments legacy `type`-only nodes with derived `deviceTypeId` in-memory without persisting; save persists augmented form."
    status: pending
  - id: t11-impl-nodeconfig-router
    content: "Implement save-side `assertKnownDeviceType` loop (after org check, before Prisma writes) and load-side on-read augmentation map (sensor→core-generic-sensor, …, timescaledb→core-generic-tsdb) in packages/api/src/routers/nodeConfig.ts. t10 passes."
    status: pending
  - id: t12-tests-apply-planner
    content: "Add failing tests in packages/api/src/__tests__/apply-planner.test.ts: plan synthesis branches on manifest.category (broker/ingest/tsdb) for manifest-typed nodes; orphan deviceTypeId throws `Plan synthesis blocked: orphan device types present` with no ops."
    status: pending
  - id: t13-impl-apply-planner
    content: "Refactor synthesizePlan in packages/api/src/lib/apply-planner.ts to resolve `node.data.deviceTypeId` via `getDeviceType`, branch on `manifest.category` instead of `node.type`, and throw on orphans before filtering. t12 passes."
    status: pending
  - id: t14-impl-canvas-store-and-load-augmentation
    content: "Extend apps/web/stores/canvas-store.ts: `addNode(deviceTypeId, position)` seeds via `defaultNodeData(deviceTypeId)`; `loadConfig` flags unresolved `deviceTypeId` as `__orphan: true` and switches xyflow `type` to `'orphan'`; add `replaceDeviceType(nodeId, newId)` helper for migrate-flow."
    status: pending
  - id: t15-impl-device-node-renderer
    content: "Create apps/web/components/canvas/nodes/device-node.tsx (single generic renderer reading manifest by `data.deviceTypeId`: lucide iconRef, accentColor, label, StatusDot, msgPerSec, source/target Handle inferred from `manifest.category`). Convert each of the six existing per-category node files into thin 5-line shims importing DeviceNode."
    status: pending
  - id: t16-impl-orphan-node-and-migrate-dialog
    content: "Create apps/web/components/canvas/nodes/orphan-node.tsx (read-only renderer + kebab menu Migrate/Delete) and the Migrate Dialog (lists same-category manifests via `listDeviceTypes({ category })`). Wire xyflow `nodeTypes` to include `'orphan': OrphanNode` in canvas.tsx."
    status: pending
  - id: t17-impl-node-palette
    content: "Rewrite apps/web/components/canvas/node-palette.tsx: 6 category tabs (Sensor/Gateway/Broker/Ingest/TSDB/Monitoring), `listDeviceTypes()`-driven entries, free-text search across displayName+manufacturer+model+firmwareTypeIds, Recently-used row persisted via localStorage key `controlai:palette:recent:${orgId}` (cap 8 FIFO). Drag payload becomes `{ deviceTypeId }`."
    status: pending
  - id: t18-impl-canvas-validation-wiring
    content: "Modify apps/web/components/canvas/canvas.tsx: rewrite `handleIsValidConnection` to call `validateConnection()` from shared-types with edge-count derivations; on rejection show toast with rejection reason; `onDrop` reads `{ deviceTypeId }` payload and calls `addNode(deviceTypeId, position)`; gate canvas Save + Apply buttons when orphans present (tooltip names count)."
    status: pending
  - id: t19-tests-canvas-ui-palette-validation-orphan
    content: "Add Vitest + @testing-library/react tests under apps/web/components/canvas/__tests__/: node-palette.spec.tsx (tabs/search/recent), canvas-validation.spec.tsx (sensor↔sensor rejected, sensor→gateway accepted, capacity exceeded toast), orphan-node.spec.tsx (orphan render, save disabled tooltip, migrate dialog flow). Set up @testing-library/react if not already present in apps/web."
    status: pending
  - id: t20-impl-simulator-manifest-awareness
    content: "Modify apps/simulator/src/manager.ts: after loading `sensors[]`, attempt `getDeviceType(sensor.deviceTypeId)`; fall back to `core-generic-sensor`; use manifest `defaultSignal.rateMs` as floor; enforce `intervalMs >= manifest.constraints.minIntervalMs` (default 100ms). Add unit tests in apps/simulator/src/__tests__/manager.test.ts (currently no tests)."
    status: pending
  - id: t21-impl-deprecate-legacy-shims
    content: "Mark NODE_TYPES / NodeType / legacy defaultNodeData(type) as @deprecated in packages/shared-types/src/node-types.ts (console.warn-on-first-use in non-prod). Reduce apps/web/components/canvas/connection-rules.ts to a re-export shim of `validateConnection`. Add `pnpm --filter @controlai-web/web run check:deprecated` script (ripgrep gate) returning zero hits outside shim files."
    status: pending
  - id: t22-docs-and-validation-gate
    content: "Write docs/device-type-authoring.md (manifest authoring how-to: skeleton, validation, icon/accent conventions, checklist). Update apps/web/README.md mentioning `listDeviceTypes()` is the canvas catalog source. Run `pnpm -r typecheck`, `pnpm -r test`, `pnpm --filter @controlai-web/web lint`, `openspec validate add-plugin-device-type-registry --strict` — all clean."
    status: pending
---

# Plan: Plugin-style device-type registry

## Background & Research

### Spec context — what this change does

This is spec **#1 of 4** in the `multi-broker-multi-ingest-and-identity-rewrite` chain. Specs 2 (unregistered-device-lifecycle), 3 (extend-gateway-register-handshake), and 4 (multi-broker-multi-ingest) all assume this manifest registry is the single source of truth for device categories, ports, protocols, and per-port capacity. **Land this cleanly first** — there are no shortcuts available downstream.

**Reference research files (already saved by prior work):**
- `.slash/workspace/research/device-type-registry-prior-art.md` — ThingsBoard / Home Assistant / Matter.js / DTDL `maxMultiplicity` prior art; recommends the in-repo TS module + Zod approach implemented here.
- `.slash/workspace/research/canvas-library-comparison.md` — confirms xyflow v12.10.2's `isValidConnection` prop pattern.

**Reference spec docs (read in full):**
- `openspec/changes/add-plugin-device-type-registry/proposal.md` (83 lines).
- `openspec/changes/add-plugin-device-type-registry/design.md` (324 lines — schema, registry API, manifest pattern, connection flow, orphan UX, migration table, performance budgets).
- `openspec/changes/add-plugin-device-type-registry/tasks.md` (173 lines — code-ready checklist with file paths, line budgets, acceptance checks).
- `openspec/changes/add-plugin-device-type-registry/specs/device-type-registry/spec.md` (244 lines — 8 ADDED requirements with scenarios; canonical for IDs).

**Canonical ID format:** the spec delta uses `core-generic-sensor`, `core-generic-gateway`, `core-generic-broker`, `core-generic-ingest`, `core-generic-tsdb`, `core-generic-monitoring`. The proposal mentions `core/generic-sensor` in prose — the spec delta wins. Use the hyphenated form everywhere (file directory layout still uses `manifests/core/` for organization).

---

### Current shared-types shape (what we're extending, what we're shimming)

**Package**: `@controlai-web/shared-types` (`packages/shared-types/package.json`).
- Zod: `^3.23.8` (production dep — fine to use Zod everywhere).
- Build: `tsup src/index.ts --format cjs,esm --dts` (single entry point — `index.ts` is the only export surface).
- **No vitest config today.** Tests live in `packages/api/src/__tests__/` and consume shared-types from outside. Task t01 adds a vitest harness here so the new device-types tests can run inside this package.

**Current `packages/shared-types/src/index.ts` (lines 1–6):**
```ts
export * from './enums';
export * from './validation';
export * from './node-types';
export * from './apply';
export * from './connection-rules';
export * from './gateway';
```

**Current `packages/shared-types/src/node-types.ts` (lines 5–14, 18–69, 71–86, 92–107):**
- `export const NODE_TYPES = ['sensor','gateway','broker','ingest','timescaledb','monitoring'] as const;`
- `export type NodeType = typeof NODE_TYPES[number];`
- Six per-node Zod data schemas (`SensorDataSchema`, `GatewayDataSchema`, `BrokerDataSchema`, `IngestDataSchema`, `TimescaleDBDataSchema`, `MonitoringDataSchema`), each with a literal `type` discriminator + `label` + status enum + `msgPerSec`.
- `export const NodeDataSchema = z.discriminatedUnion('type', [...]);`
- Inferred `NodeData = z.infer<typeof NodeDataSchema>`.
- `export function defaultNodeData(type: NodeType): NodeData { switch (type) { ... return Schema.parse({...}); } }`.

**Current `packages/shared-types/src/connection-rules.ts` (lines 12–19, 24–26):**
- `export const CONNECTION_MATRIX: Record<NodeType, NodeType[]> = { sensor: ['gateway','broker'], gateway: ['broker','ingest'], ... }`.
- `export function isValidNodeConnection(sourceType: NodeType, targetType: NodeType): boolean { return CONNECTION_MATRIX[sourceType].includes(targetType); }`.

**Decision:** keep both files; mark their exports `@deprecated` (t21); the new `defaultNodeData(deviceTypeId)` lives at `packages/shared-types/src/device-types/default-data.ts` and ships through the new `device-types` re-export. This avoids breaking imports across `apps/web`, `apps/simulator`, `packages/api`, and the existing `packages/api/src/__tests__/connection-rules.test.ts`.

---

### Current canvas shape (what we're rewiring)

**`apps/web/components/canvas/canvas.tsx` lines 38–45 — hardcoded nodeTypes map:**
```tsx
const NODE_TYPES = {
  sensor: SensorNode,
  gateway: GatewayNode,
  broker: BrokerNode,
  ingest: IngestNode,
  timescaledb: TimescaleDBNode,
  monitoring: MonitoringNode,
};
```

**`apps/web/components/canvas/canvas.tsx` lines 143–158 — current isValidConnection:**
```tsx
const handleIsValidConnection = useCallback((connection: Connection) => {
  const ok = checkConnectionValid(connection, nodes);
  if (!ok) toast.error('Invalid connection');
  return ok;
}, [nodes]);
```

**`apps/web/components/canvas/canvas.tsx` lines 161–187 — onDrop:**
- Reads MIME `'application/reactflow-nodetype'` → `nodeType` string.
- `screenToFlowPosition()` → position.
- `addNode({ id: crypto.randomUUID(), type: nodeType, position, data: defaultNodeData(nodeType) })`.

**`apps/web/components/canvas/canvas.tsx` lines 371–388 — ReactFlow props:**
```tsx
<ReactFlow nodes={nodesWithUi} edges={edges} onNodesChange={...} onEdgesChange={...}
  onConnect={...} isValidConnection={handleIsValidConnection}
  nodeTypes={NODE_TYPES} deleteKeyCode={['Backspace','Delete']} fitView />
```

**`apps/web/components/canvas/node-palette.tsx` lines 13–62 — PALETTE_ITEMS hardcoded array of 6 items {type, icon (emoji), label, description, color}; onDragStart sets MIME 'application/reactflow-nodetype' with `item.type`.** No tabs/search/recently-used today.

**Six `apps/web/components/canvas/nodes/*-node.tsx` files — same pattern:**
- Accept `NodeProps`, cast `rawData` to typed schema (e.g. `SensorData`).
- Render `<StatusDot />` + `<Handle position=... />` + icon emoji + label + per-type metadata.
- `<NodeConfigDialog />` on double-click.
- `BrokerNode` additionally uses `useCanvasContext()` + `trpc.site.list` (line refs in explorer output).

**`apps/web/stores/canvas-store.ts`:**
- Zustand (no immer middleware — v5 default behavior).
- `addNode` (lines 159–170): appends to nodes, pushes snapshot to past, marks dirty.
- `updateNodeData` (lines 172–185): merges partial into node by id.
- `loadConfig` (lines 236–247): replaces nodes/edges, clears history, marks clean. **This is where the orphan flagging slots in.**
- `markSaved`, `markDirty`, `updateNodeTelemetry`, `undo`/`redo`.

**xyflow version:** `@xyflow/react@^12.10.2` (`apps/web/package.json` line 29). `isValidConnection` prop signature: `(connection: Connection) => boolean` — synchronous, runs every mouse-move during drag.

**Dialog primitive:** `apps/web/components/ui/dialog.tsx` (radix wrapper — Dialog/DialogContent/DialogHeader/DialogFooter/DialogTitle/DialogDescription).

**Toast:** `sonner` — `import { toast } from 'sonner'` in canvas.tsx line 17; use `toast.error(reason)` for rejection feedback.

**No localStorage helpers exist** — task t17 introduces ad-hoc `window.localStorage.getItem/setItem` calls (no shared util). Acceptable scope; defer abstraction.

**Test setup in apps/web:** vitest configured (`apps/web/vitest.config.ts` lines 1–10 — exclude e2e + node_modules; passWithNoTests true). **No `@testing-library/react` usage today.** Task t19 installs / configures `@testing-library/react` + `@testing-library/jest-dom` if not present, mirroring the dependency conventions in `apps/web/package.json`.

---

### Current server-side shape (nodeConfig, apply-planner, simulator)

**`packages/api/src/routers/nodeConfig.ts`:**
- Router export: `export const nodeConfigRouter = router({ ... })` (lines 5–149) with `load`, `save`, `listVersions`, `setActive`.
- `load` (lines 10–30) → Prisma `nodeConfig.findFirst({ isActive: true })` (line 19), fallback `findFirst()` (line 25), returns full row or `null`. **Insertion point for on-read augmentation: after line 29, before return.**
- `save` (lines 37–85) input Zod schema lines 38–44: `{ orgId, siteGroupId, nodes: z.array(z.unknown()), edges: z.array(z.unknown()) }`. Org/siteGroup ownership check lines 47–50 (uses `TRPCError({ code: 'FORBIDDEN' })`). **Insertion point for `assertKnownDeviceType` loop: after line 50, before Prisma `create()`/`update()` writes (lines 61–84).**
- Test file: `packages/api/src/__tests__/nodeConfig.test.ts` (lines 1–244) — uses mocked Prisma (lines 15–41) + simulated router logic (lines 45–103) + vitest `vi.fn()`. **Extend this with t10 cases.**

**`packages/api/src/lib/apply-planner.ts`:**
- `synthesizePlan(nodes, edges, daemonState, existingTenantId?, existingSites?)` (lines 72–82) — pure function, no early type validation.
- Filtering by `node.type` string (lines 85–87): `nodes.filter(n => n.type === 'broker')`, `'ingest'`, `'timescaledb'`. **Refactor target: replace with `getDeviceType(n.data.deviceTypeId)?.category === 'broker'` etc.**
- Broker handling lines 100–184 reads `node.data.kind`, `node.data.throughput`. Ingest lines 187–225 reads `node.data.direction`. TSDB lines 228–244 reads `node.data.retention`.
- Test file: `packages/api/src/__tests__/apply-planner.test.ts` (lines 1–120). Direct function calls with mock GraphNode/DaemonState. **Extend with t12 cases.**

**`apps/simulator/src/manager.ts`:**
- Gateway loader lines 50–77: Prisma `gateway.findUniqueOrThrow()` (line 55) → `GatewayDTO` with decrypted certs + `sensors: row.sensors as unknown as SensorConfig[]` (line 68).
- SignalGenerator instantiation lines 142–145 — one generator per sensor.
- Publish interval line 207: `sensor.intervalMs` — directly into `setInterval()`.
- **No test file exists today.** t20 creates `apps/simulator/src/__tests__/manager.test.ts`.

**TRPCError import**: `import { TRPCError } from '@trpc/server';` — used at lines 1, 17, 50, 96, 131 of nodeConfig.ts. Match this convention everywhere.

**Shared-types reachability**: both `packages/api` and `apps/simulator` already declare `"@controlai-web/shared-types": "workspace:*"` and import from it. `assertKnownDeviceType` becomes available with zero new dependency wiring.

---

### Key code patterns to preserve

1. **Caller-stack capture for duplicate-id Error** — design §3.2 spec:
```ts
const registry = new Map<string, DeviceType>();
const registrationCallSite = new Map<string, string>();

function captureCaller(): string {
  const stack = new Error().stack ?? '';
  const lines = stack.split('\n');
  // skip Error, captureCaller, registerDeviceType → first user frame is index 3
  return lines[3]?.trim() ?? '<unknown>';
}

export function registerDeviceType(manifest: unknown): void {
  const parsed = DeviceTypeSchema.parse(manifest);
  if (registry.has(parsed.id)) {
    throw new Error(
      `Duplicate device-type id: ${parsed.id}. First registration: ${registrationCallSite.get(parsed.id)}`
    );
  }
  registry.set(parsed.id, parsed);
  registrationCallSite.set(parsed.id, captureCaller());
}
```

2. **Category-specific superRefine pattern** (design §3.1):
```ts
export const DeviceTypeSchema = z.object({ /* base fields */ }).strict()
  .superRefine((m, ctx) => {
    if (m.category === 'sensor') {
      if (!m.defaultSignal) ctx.addIssue({ code: 'custom', path: ['defaultSignal'], message: 'sensor requires defaultSignal' });
      if (m.ports.some(p => p.direction !== 'out')) ctx.addIssue({ code: 'custom', path: ['ports'], message: 'sensor ports must be direction:out' });
    }
    if (m.category === 'broker') {
      const mqtt = m.ports.filter(p => p.portType === 'mqtt-topic');
      if (mqtt.length !== 1) ctx.addIssue({ code: 'custom', path: ['ports'], message: `broker requires exactly one mqtt-topic port, got ${mqtt.length}` });
      if (m.defaultSignal) ctx.addIssue({ code: 'custom', path: ['defaultSignal'], message: 'broker forbids defaultSignal' });
    }
    if (m.category === 'gateway') {
      const hasBus = m.ports.some(p => p.portType === 'rs485-bus' || p.portType === 'mqtt-topic');
      if (!hasBus) ctx.addIssue({ code: 'custom', path: ['ports'], message: 'gateway requires at least one rs485-bus or mqtt-topic port' });
    }
    if (m.category === 'ingest' || m.category === 'tsdb' || m.category === 'monitoring') {
      if (m.ports.length > 0) ctx.addIssue({ code: 'custom', path: ['ports'], message: `${m.category} must have no ports` });
      if (m.defaultSignal) ctx.addIssue({ code: 'custom', path: ['defaultSignal'], message: `${m.category} forbids defaultSignal` });
    }
  });
```

3. **validateConnection ordered checks** (design §3.2 + spec.md scenarios). Order matters for the rejection `code` returned:
```ts
// 1. UNKNOWN_DEVICE_TYPE if source or target id not in registry
// 2. INVALID_CATEGORY_PAIR if both manifests exist but no shared protocol family between source outProtocols and target port acceptsProtocols
// 3. PROTOCOL_MISMATCH if a target port was specified but does not accept any of source's protocols
// 4. CAPACITY_EXCEEDED if sourceCurrentChildren + 1 > sourcePort.maxCount (or targetCurrentParents + 1 > targetPort.maxCount)
// 5. ok: true
```
For sensors with no declared ports, `outProtocols` defaults to `[manifest.defaultSignal.format]`-equivalent inferred protocols — encode the inference rule in registry.ts (e.g. `'json'/'cbor' → 'modbus-rtu' + 'rs485-serial-generic'`; expose a helper `inferSensorOutProtocols(manifest)`).

4. **xyflow isValidConnection** is synchronous and called per-mousemove. Keep `validateConnection` allocation-free in the hot path; precompute edge counts via `useMemo` against the current edges array.

5. **Migration table** (design §7, canonical IDs from spec.md):
```
sensor       → core-generic-sensor
gateway      → core-generic-gateway
broker       → core-generic-broker
ingest       → core-generic-ingest
timescaledb  → core-generic-tsdb       (NOTE: legacy 'timescaledb' → new 'tsdb')
monitoring   → core-generic-monitoring
```
Augment in-memory only inside `nodeConfig.load`; persist on next `save` (which itself now validates via `assertKnownDeviceType`).

---

### Testing policy

- **Strict TDD**: every implementation todo (`t03`, `t05`, `t07`, `t09`, `t11`, `t13`) has a paired test todo (`t02`, `t04`, `t06`, `t08`, `t10`, `t12`) that lands first and fails. Implementation makes the tests green.
- **Vitest everywhere**: shared-types gains vitest in t01; api already has it; apps/web already has it.
- **Snapshot tests for manifests** (t06) lock the parsed shape — any future schema-tightening that changes a manifest's parsed form forces a deliberate snapshot update.
- **Aggregator contract test** (t08) is the firewall against silently shipping a new manifest file that nobody imports.
- **No e2e in this plan** — orphan/Migrate/palette behaviors verified at component-test level (t19); cross-package wiring covered by api router tests (t10, t12) and simulator tests (t20).

---

## Testing Plan

- [ ] `t01-test-harness-shared-types`: Add Vitest devDependency + config + `test` script to packages/shared-types so `pnpm --filter @controlai-web/shared-types test` resolves. Acceptance: `pnpm --filter @controlai-web/shared-types test` exits 0 against a trivial placeholder spec.
- [ ] `t02-tests-schema-port-protocol`: Failing tests at `packages/shared-types/src/device-types/__tests__/schema.spec.ts` (≥18 cases): valid full manifest passes; broker without exactly one mqtt-topic port fails; sensor without defaultSignal fails; ingest/tsdb/monitoring with ports fails; gateway without any rs485-bus/mqtt-topic port fails; invalid accentColor regex fails; invalid id regex fails; duplicate port ids inside one manifest fails. Plus port-types.spec.ts + protocol-families.spec.ts covering enum membership.
- [ ] `t04-tests-registry-runtime`: Failing tests at `packages/shared-types/src/device-types/__tests__/registry.spec.ts` (≥12 cases) and `validate-connection.spec.ts` (≥15 cases). Cover: register/get/list happy paths, listDeviceTypes({category}) filtering, duplicate-id throws with both call-site hints, assertKnownDeviceType('missing') throws Error with `code === 'UNKNOWN_DEVICE_TYPE'`; validateConnection ok for sensor→gateway via rs485-bus, CAPACITY_EXCEEDED at maxCount, PROTOCOL_MISMATCH for analog-4-20ma→rs485-only, INVALID_CATEGORY_PAIR for broker→sensor, UNKNOWN_DEVICE_TYPE for missing source.
- [ ] `t06-tests-manifests-core-daejak`: Per-manifest snapshot tests at `__tests__/manifests/core.spec.ts` (6 cases) and `__tests__/manifests/daejak.spec.ts` (2 cases). Each parses + matches snapshot + asserts category + asserts exactly-once registration.
- [ ] `t08-tests-aggregator-contract`: Failing test at `__tests__/aggregator.spec.ts`. Enumerate `manifests/**/*.ts` via `node:fs.readdirSync({ recursive: true })`; assert each path appears as `import './manifests/<vendor>/<file>'` in `device-types/index.ts`; assert `listDeviceTypes().length === discoveredFileCount`.
- [ ] `t10-tests-nodeconfig-router`: Failing tests in `packages/api/src/__tests__/nodeConfig.test.ts`. Cases: save with unknown deviceTypeId rejects (TRPCError BAD_REQUEST mentioning id); load with legacy `type: 'sensor'` returns node augmented with `data.deviceTypeId: 'core-generic-sensor'`; load with `type: 'timescaledb'` returns `core-generic-tsdb`; underlying Prisma row is NOT rewritten on load (assert mock `update` not called).
- [ ] `t12-tests-apply-planner`: Failing tests in `packages/api/src/__tests__/apply-planner.test.ts`. Cases: synthesizePlan against nodes whose `data.deviceTypeId` resolves to `core-generic-broker` produces broker ops; resolves to `core-generic-ingest` produces ingest ops; one orphan node (`deviceTypeId: 'missing-foo'`) throws `Error` whose message contains `'Plan synthesis blocked'`; orphan throw yields zero ops.
- [ ] `t19-tests-canvas-ui-palette-validation-orphan`: Vitest + @testing-library/react tests under `apps/web/components/canvas/__tests__/`. Cases: palette renders 6 category tabs; default tab Sensor; search "daejak" filters to daejak-*; recently-used array writes localStorage with `controlai:palette:recent:${orgId}` key; canvas drag sensor↔sensor → toast.error fired & no edge; sensor→gateway accepted; 17th edge into daejak-main-v1.rs485-1 (maxCount=16) → CAPACITY_EXCEEDED toast; loading config with `deviceTypeId: 'missing-foo'` renders OrphanNode + save button disabled with tooltip; migrate dialog lists same-category manifests; selecting one clears orphan + re-enables save.
- [ ] `t20-impl-simulator-manifest-awareness`: Add `apps/simulator/src/__tests__/manager.test.ts` with cases — sensor with known deviceTypeId resolves manifest; missing deviceTypeId falls back to `core-generic-sensor`; intervalMs below manifest.constraints.minIntervalMs is clamped to minIntervalMs (default 100).

## Implementation Plan

- [ ] `t01-test-harness-shared-types`: Add `vitest@^2` + `@types/node` devDeps to `packages/shared-types/package.json`. Create `packages/shared-types/vitest.config.ts` matching apps/web style. Add `"test": "vitest run"` script. Confirm a trivial `src/__sanity__/sanity.spec.ts` runs green and remove after.
- [ ] `t03-impl-schema-port-protocol`: Create `packages/shared-types/src/device-types/port-types.ts` (PortType Zod enum + PORT_TYPE_META map), `protocol-families.ts` (ProtocolFamily Zod enum: `'mqtt'|'modbus-rtu'|'modbus-tcp'|'lorawan'|'analog-4-20ma'|'analog-0-10v'|'rs485-serial-generic'`), `schema.ts` (Category, DevicePortSchema, DefaultSignalSchema, DeviceTypeSchema with the four category superRefine rules from Background §2 above). Make t02 pass.
- [ ] `t05-impl-registry-runtime`: Create `packages/shared-types/src/device-types/registry.ts` (in-memory `Map<string, DeviceType>` + `registrationCallSite` + `captureCaller()` via Error stack; export `registerDeviceType`, `getDeviceType`, `listDeviceTypes`, `assertKnownDeviceType`, `validateConnection`, plus `ConnectionValidationResult` type). Create `packages/shared-types/src/device-types/default-data.ts` exporting `defaultNodeData(deviceTypeId: string): { deviceTypeId, category, label, visual, config, status, msgPerSec }` (returns the manifest-driven seed described in design §6). validateConnection enforces the ordered checks from Background §3. Make t04 pass.
- [ ] `t07-impl-manifests-core-daejak`: Create six core manifests in `packages/shared-types/src/device-types/manifests/core/` — `generic-sensor.ts` (id `core-generic-sensor`, category sensor, defaultSignal `{rateMs:1000, format:'json', units:'value', range:{min:0,max:100}}`, visual `{iconRef:'thermometer', accentColor:'#10b981'}`), `generic-gateway.ts` (id `core-generic-gateway`, category gateway, ports `[{id:'rs485-1', direction:'in', portType:'rs485-bus', maxCount:16, acceptsProtocols:['modbus-rtu','rs485-serial-generic']}]`, visual `{iconRef:'router', accentColor:'#3b82f6'}`), `generic-broker.ts` (category broker, single mqtt-topic port maxCount 1000, visual iconRef `'radio-tower'`), `generic-ingest.ts` (category ingest, no ports, iconRef `'arrow-down-to-line'`), `generic-tsdb.ts` (category tsdb, no ports, iconRef `'database'`), `generic-monitoring.ts` (category monitoring, no ports, iconRef `'activity'`). Create two DAEJAK manifests in `manifests/daejak/` per design §3.3: `daejak-main-v1.ts` and `daejak-vm.ts` (firmwareTypeIds `['DAEJAK_VM']`, defaultSignal V/0–24, iconRef `'gauge'`). Each manifest is a side-effect file calling `registerDeviceType({...})`. Make t06 pass.
- [ ] `t09-impl-aggregator-and-package-index`: Create `packages/shared-types/src/device-types/index.ts` listing every manifest as a side-effect import in alphabetical order, plus `export * from './schema'; export * from './registry'; export * from './port-types'; export * from './protocol-families'; export * from './default-data';`. Extend `packages/shared-types/src/index.ts` to add `export * from './device-types';` AT THE END (preserves existing precedence; explicit re-exports in shim files override deprecated symbols where they collide). Make t08 pass.
- [ ] `t11-impl-nodeconfig-router`: Modify `packages/api/src/routers/nodeConfig.ts`. (a) Import `assertKnownDeviceType` from `@controlai-web/shared-types`. (b) In `save` (after line 50, before line 61): iterate `input.nodes as Array<{ data?: { deviceTypeId?: string } }>`; for each node, call `assertKnownDeviceType(node.data?.deviceTypeId ?? '')` inside try/catch; on throw, re-throw as `TRPCError({ code: 'BAD_REQUEST', message: 'Unknown device-type: <id>' })`. (c) In `load` (between line 29 and return): if response exists, walk `nodes` array; for any node where `data.deviceTypeId` is missing AND `type` is a legacy NodeType, set `data.deviceTypeId = LEGACY_TYPE_MAP[type]` using the migration table. Do NOT persist. Make t10 pass.
- [ ] `t13-impl-apply-planner`: Modify `packages/api/src/lib/apply-planner.ts`. (a) Import `getDeviceType` from shared-types. (b) At top of `synthesizePlan` (before line 85), iterate `nodes`; collect any whose `getDeviceType(n.data?.deviceTypeId)` returns undefined; if non-empty, `throw new Error('Plan synthesis blocked: orphan device types present (count=' + orphans.length + ')')`. (c) Replace `nodes.filter(n => n.type === 'broker')` etc. with `nodes.filter(n => getDeviceType(n.data.deviceTypeId)?.category === 'broker')` (and `'ingest'`, `'tsdb'` accordingly — note legacy `'timescaledb'` is no longer matched at this layer). Make t12 pass.
- [ ] `t14-impl-canvas-store-and-load-augmentation`: Modify `apps/web/stores/canvas-store.ts`. (a) Change `addNode` to accept `(deviceTypeId: string, position: { x: number; y: number })`, call `assertKnownDeviceType(deviceTypeId)`, seed `data` via `defaultNodeData(deviceTypeId)`, generate `id` via `crypto.randomUUID()`, set xyflow `type` to `manifest.category` (or `'orphan'` once t16 lands — gated behind `getDeviceType(deviceTypeId)?`). (b) In `loadConfig`: for each loaded node, if `data.deviceTypeId` is missing OR `getDeviceType(data.deviceTypeId)` returns undefined, flag transient `data.__orphan = true` and set xyflow `type = 'orphan'`. (c) Add `replaceDeviceType(nodeId: string, newDeviceTypeId: string)` that calls `assertKnownDeviceType`, rewrites `node.data.deviceTypeId`, clears `__orphan`, switches xyflow `type` to `manifest.category`, pushes to history.
- [ ] `t15-impl-device-node-renderer`: Create `apps/web/components/canvas/nodes/device-node.tsx` — single generic component reading `data.deviceTypeId`, calling `getDeviceType()`, rendering lucide icon (resolve dynamically via `import * as Icons from 'lucide-react'; const Icon = Icons[manifest.visual.iconRef as keyof typeof Icons] ?? Icons.Box;`), accentColor border, label, StatusDot, msgPerSec, and Handle(s) inferred from `manifest.category`: sensor → single source Right; gateway/broker → both target Left + source Right; ingest/tsdb/monitoring → target Left only. Convert `sensor-node.tsx`, `gateway-node.tsx`, `broker-node.tsx`, `ingest-node.tsx`, `timescaledb-node.tsx`, `monitoring-node.tsx` to 5-line shims that re-export `DeviceNode` (preserves xyflow nodeTypes registration for back-compat during incremental rollout). BrokerNode-specific `useCanvasContext + trpc.site.list` behavior moves into a category-conditional inside DeviceNode (`if (manifest.category === 'broker') { ... }`).
- [ ] `t16-impl-orphan-node-and-migrate-dialog`: Create `apps/web/components/canvas/nodes/orphan-node.tsx` — greyscale chrome, "Unknown device type: `<id>`" badge, kebab menu with **Migrate** (opens MigrateDialog) and **Delete** (calls `useCanvasStore.removeNode`). Create the MigrateDialog inline or in `apps/web/components/canvas/nodes/migrate-device-type-dialog.tsx`: built on `@radix-ui/react-dialog` via existing `components/ui/dialog.tsx`; lists `listDeviceTypes({ category })` from a category picker (defaults to "any" since the orphan's category is unknown); confirms via `useCanvasStore.getState().replaceDeviceType(nodeId, newId)`. Register `'orphan': OrphanNode` in canvas.tsx's `nodeTypes` map (already moved to dynamic registration in t18).
- [ ] `t17-impl-node-palette`: Rewrite `apps/web/components/canvas/node-palette.tsx`. (a) Replace PALETTE_ITEMS with `listDeviceTypes()`. (b) Add category tab strip in order `Sensor / Gateway / Broker / Ingest / TSDB / Monitoring`, default Sensor. (c) Free-text search input filtering across `displayName + manufacturer + model + firmwareTypeIds.join(' ')` (case-insensitive). When search non-empty, show all categories matched (with category-prefix label per spec.md scenario). (d) "Recently used" row pinned above active tab's grid; load on mount from `localStorage.getItem('controlai:palette:recent:' + orgId)` (parse as JSON string array, cap 8); on drag-start: prepend deviceTypeId, dedupe, slice 8, persist. orgId pulled from existing canvas context. (e) Drag payload becomes JSON-stringified `{ deviceTypeId }` on a NEW MIME `'application/reactflow-devicetypeid'` (keep legacy MIME for one minor release in case any external embedder relies on it).
- [ ] `t18-impl-canvas-validation-wiring`: Modify `apps/web/components/canvas/canvas.tsx`. (a) Replace hardcoded `NODE_TYPES` (lines 38–45) with `useMemo` that imports DeviceNode + OrphanNode and registers `{ sensor: DeviceNode, gateway: DeviceNode, broker: DeviceNode, ingest: DeviceNode, tsdb: DeviceNode, monitoring: DeviceNode, orphan: OrphanNode }`. (b) Rewrite `handleIsValidConnection` (lines 143–158) to call `validateConnection` from shared-types with derived `sourceCurrentChildren`/`targetCurrentParents` from current edges array; on `{ok:false}` invoke `toast.error(result.reason)` and return false. (c) Add `onConnect` defensive re-validation: if validateConnection returns not-ok, drop the edge and toast. (d) Update `onDrop` to read MIME `'application/reactflow-devicetypeid'` first (fall back to legacy MIME with legacy-type→core-generic-* mapping) and call `addNode(deviceTypeId, position)`. (e) Expose `hasOrphans = useMemo(() => nodes.some(n => n.data?.__orphan), [nodes])`; pass to canvas toolbar so Save button is disabled with tooltip `'N nodes have unknown device types — migrate or delete before saving'` and the same applies to Apply.
- [ ] `t20-impl-simulator-manifest-awareness`: Modify `apps/simulator/src/manager.ts`. After loading `sensors[]` (around line 97), call `getDeviceType(sensor.deviceTypeId)` for each; fall back to `getDeviceType('core-generic-sensor')` when missing (transitional). Use `manifest.defaultSignal.rateMs` as default `intervalMs` when sensor lacks one. Enforce floor: `intervalMs = Math.max(intervalMs, manifest.constraints.minIntervalMs ?? 100)`. Pass merged config into `new SignalGenerator(sensor)`. Add `apps/simulator/src/__tests__/manager.test.ts` covering t20 cases.
- [ ] `t21-impl-deprecate-legacy-shims`: Add `@deprecated` JSDoc + first-use console.warn (non-prod gate via `process.env.NODE_ENV !== 'production'` + module-scoped boolean) to `NODE_TYPES`, `NodeType`, and `defaultNodeData(type: NodeType)` exports in `packages/shared-types/src/node-types.ts`. Keep `SensorDataSchema` etc. UNTOUCHED (DeviceNode reads `data.config` against these for legacy node back-compat). Reduce `apps/web/components/canvas/connection-rules.ts` to: `export { validateConnection as isValidConnection } from '@controlai-web/shared-types';` plus a deprecation comment. Add a new `apps/web` script `"check:deprecated": "rg --no-messages -n 'NODE_TYPES|CONNECTION_MATRIX' apps/web/components apps/web/stores apps/web/app apps/web/lib | grep -v 'connection-rules.ts' || true"` — wire to `pnpm --filter @controlai-web/web run check:deprecated`; CI gate added in a follow-up if desired.
- [ ] `t22-docs-and-validation-gate`: Write `docs/device-type-authoring.md` (≤100 LOC markdown) — manifest skeleton, validation expectations, icon/accent conventions, "add a new manifest" checklist. Update `apps/web/README.md` with a short section: "Canvas catalog is sourced from `listDeviceTypes()`; add a new device by dropping a manifest under `packages/shared-types/src/device-types/manifests/<vendor>/<id>.ts` and adding it to `device-types/index.ts`." Final validation: `pnpm -r typecheck`, `pnpm -r test`, `pnpm --filter @controlai-web/web lint`, `openspec validate add-plugin-device-type-registry --strict` — all clean.

## Delegation Notes

Strict file-allowlist boundaries per batch. **No two parallel coders touch the same file in the same batch.**

### Batch 1 — Foundation (sequential prerequisite)
- [ ] **Coder F (foundation)**: `t01-test-harness-shared-types` → files: `packages/shared-types/package.json`, `packages/shared-types/vitest.config.ts` (new).

### Batch 2 — Shared-types core (parallel, tests first then impl)
- [ ] **Coder A (schema tests)**: `t02-tests-schema-port-protocol` → files: `packages/shared-types/src/device-types/__tests__/schema.spec.ts` (new), `port-types.spec.ts` (new), `protocol-families.spec.ts` (new).
- [ ] **Coder A (schema impl, same coder, sequential within slot)**: `t03-impl-schema-port-protocol` → files: `packages/shared-types/src/device-types/port-types.ts` (new), `protocol-families.ts` (new), `schema.ts` (new).
- [ ] **Coder B (registry tests)**: `t04-tests-registry-runtime` → files: `packages/shared-types/src/device-types/__tests__/registry.spec.ts` (new), `validate-connection.spec.ts` (new), `default-data.spec.ts` (new). **Depends on t03 types compiling.**
- [ ] **Coder B (registry impl)**: `t05-impl-registry-runtime` → files: `packages/shared-types/src/device-types/registry.ts` (new), `default-data.ts` (new).

### Batch 3 — Manifests + aggregator (parallel, depends on Batch 2)
- [ ] **Coder C**: `t06-tests-manifests-core-daejak` then `t07-impl-manifests-core-daejak` → files: `packages/shared-types/src/device-types/manifests/core/{generic-sensor,generic-gateway,generic-broker,generic-ingest,generic-tsdb,generic-monitoring}.ts` (6 new), `manifests/daejak/{daejak-main-v1,daejak-vm}.ts` (2 new), `__tests__/manifests/core.spec.ts` (new), `__tests__/manifests/daejak.spec.ts` (new).
- [ ] **Coder D (waits on Coder C manifest files to exist)**: `t08-tests-aggregator-contract` then `t09-impl-aggregator-and-package-index` → files: `packages/shared-types/src/device-types/__tests__/aggregator.spec.ts` (new), `packages/shared-types/src/device-types/index.ts` (new), `packages/shared-types/src/index.ts` (modify — append one line).

### Batch 4 — Server-side consumers (parallel, depends on Batch 3)
- [ ] **Coder E**: `t10-tests-nodeconfig-router` then `t11-impl-nodeconfig-router` → files: `packages/api/src/__tests__/nodeConfig.test.ts` (modify), `packages/api/src/routers/nodeConfig.ts` (modify).
- [ ] **Coder F**: `t12-tests-apply-planner` then `t13-impl-apply-planner` → files: `packages/api/src/__tests__/apply-planner.test.ts` (modify), `packages/api/src/lib/apply-planner.ts` (modify).

### Batch 5 — Canvas store + simulator (parallel, depends on Batch 3)
- [ ] **Coder G**: `t14-impl-canvas-store-and-load-augmentation` → files: `apps/web/stores/canvas-store.ts` (modify).
- [ ] **Coder H**: `t20-impl-simulator-manifest-awareness` → files: `apps/simulator/src/manager.ts` (modify), `apps/simulator/src/__tests__/manager.test.ts` (new), `apps/simulator/package.json` (only if vitest devDep missing).

### Batch 6 — Canvas UI surfaces (sequential — touch overlapping component tree)
- [ ] **Coder I (sequential, owns canvas/nodes/* + canvas.tsx)**: in order
  1. `t15-impl-device-node-renderer` → files: `apps/web/components/canvas/nodes/device-node.tsx` (new), then convert `sensor-node.tsx`, `gateway-node.tsx`, `broker-node.tsx`, `ingest-node.tsx`, `timescaledb-node.tsx`, `monitoring-node.tsx` to 5-line shims.
  2. `t16-impl-orphan-node-and-migrate-dialog` → files: `apps/web/components/canvas/nodes/orphan-node.tsx` (new), `apps/web/components/canvas/nodes/migrate-device-type-dialog.tsx` (new).
  3. `t17-impl-node-palette` → files: `apps/web/components/canvas/node-palette.tsx` (rewrite).
  4. `t18-impl-canvas-validation-wiring` → files: `apps/web/components/canvas/canvas.tsx` (modify).
- [ ] **Coder J (depends on Coder I)**: `t19-tests-canvas-ui-palette-validation-orphan` → files: `apps/web/components/canvas/__tests__/node-palette.spec.tsx` (new), `canvas-validation.spec.tsx` (new), `orphan-node.spec.tsx` (new), `apps/web/package.json` (only if `@testing-library/react` + `@testing-library/jest-dom` devDeps missing), `apps/web/vitest.setup.ts` (new if introducing jest-dom).

### Batch 7 — Cleanup + docs (sequential, depends on all prior)
- [ ] **Coder K**: `t21-impl-deprecate-legacy-shims` → files: `packages/shared-types/src/node-types.ts` (modify — JSDoc + warn-once), `apps/web/components/canvas/connection-rules.ts` (rewrite to re-export shim), `apps/web/package.json` (add `check:deprecated` script).
- [ ] **Coder K (sequential)**: `t22-docs-and-validation-gate` → files: `docs/device-type-authoring.md` (new), `apps/web/README.md` (modify — add catalog source note).

### Dependencies (why this order exists)

- Batch 1 (test harness) MUST land before any test todo can be exercised.
- Batch 2 (schema + registry) is the API surface every later batch imports; Coder B awaits Coder A's types.
- Batch 3 manifests use the schema; aggregator test enumerates manifest files (Coder D waits on Coder C).
- Batch 4 server-side consumers + Batch 5 canvas-store/simulator both import the registry — they can run in parallel because none touch the same file.
- Batch 6 UI surfaces are intra-package (apps/web/components/canvas/**) and share the xyflow nodeTypes map + canvas.tsx import graph — keep them strictly sequential under Coder I.
- Batch 7 cleanup adds deprecation noise that would fail tests if done before Batch 6; docs go last.

### Risk Areas

- **Cross-package ID consistency**: the on-read augmentation table (t11), validateConnection's category inferences (t05), apply-planner branching (t13), simulator fallback (t20), and the core manifests (t07) ALL hardcode `core-generic-*` strings. Centralize as `LEGACY_TYPE_MAP` exported from default-data.ts to avoid drift.
- **xyflow nodeTypes hot-swap**: switching the type map from `{ sensor: SensorNode }` to `{ sensor: DeviceNode }` plus adding `'orphan': OrphanNode` and `'tsdb': DeviceNode` (vs legacy `'timescaledb'`) risks ghost xyflow instances retaining stale React component references between renders. Ensure the `nodeTypes` object is `useMemo`-wrapped with stable identity per render.
- **Recently-used localStorage key collision**: spec mandates `controlai:palette:recent:${orgId}`. Confirm orgId is reliably available in palette render path (it's in CanvasContext per explorer). Guard the localStorage read against undefined orgId (skip persistence if unknown).
- **Server-side validation strictness**: t11 rejects `BAD_REQUEST` on unknown deviceTypeId, but the on-read augmentation in load is the same procedure surface — make absolutely sure save-time validation runs AFTER any client-applied augmentation. Test t10 must cover the "client received augmented load → client posts save with full deviceTypeId → save succeeds" round-trip.
- **Duplicate `Coder F` slot**: Batch 1 names a Coder F for the harness, Batch 4 names a Coder F for apply-planner. These are different agents in different batches — treat the letter as a per-batch label, not a persistent identity. (Renaming to per-batch unique letters acceptable during execution.)
- **Sonner toast in vitest**: component tests in t19 must mock `sonner`'s `toast` import (no real DOM toast container in jsdom) — use `vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))` at top of each spec.
- **OpenSpec strict validation**: `openspec validate add-plugin-device-type-registry --strict` (t22) — confirm spec.md scenarios all have `#### Scenario:` headers (✅ verified during planning) and every requirement has at least one scenario (✅ verified).

## Done Criteria

- [ ] All 22 `todos` in frontmatter are `status: done` and matching body Testing/Implementation checklists are `[x]`.
- [ ] `pnpm --filter @controlai-web/shared-types test` green (covers t02, t04, t06, t08 specs — ≥45 cases total).
- [ ] `pnpm --filter @controlai-web/api test` green (covers t10, t12 additions to existing test files).
- [ ] `pnpm --filter @controlai-web/web test` green (covers t19 component tests — palette, validation, orphan).
- [ ] `pnpm --filter @controlai-web/simulator test` green (covers t20 new manager.test.ts).
- [ ] `pnpm -r typecheck` clean (catches any import drift across the registry rewire).
- [ ] `pnpm --filter @controlai-web/web lint` clean.
- [ ] `pnpm --filter @controlai-web/web build` succeeds (catches any deprecated-shim regressions in app build).
- [ ] `pnpm --filter @controlai-web/web run check:deprecated` returns zero hits outside `connection-rules.ts` and node-types.ts shim file.
- [ ] `openspec validate add-plugin-device-type-registry --strict` clean.
- [ ] Manual smoke (t12.5 from tasks.md): drop a `daejak-main-v1` + a `daejak-vm` in a dev SiteGroup; observe rs485-bus port edge validation (capacity counter) + palette search filter.
- [ ] OpenSpec change `add-plugin-device-type-registry` ready for archival (mad-agent's responsibility, not this plan's).
- [ ] Specs 2 / 3 / 4 in the sequence are now UNBLOCKED — the registry exposes `assertKnownDeviceType`, `getDeviceType`, `validateConnection`, and the `core-generic-*` + `daejak-*` IDs they all assume exist.

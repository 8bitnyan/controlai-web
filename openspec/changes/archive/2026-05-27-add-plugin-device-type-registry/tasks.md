# Tasks: add-plugin-device-type-registry

Code-ready checklist. Every task has target file path(s), the function/symbol introduced, an acceptance check, and a rough line budget. Order is mandatory: foundations first, consumers second, deletions/cleanup last.

## 1. Schema, port types, protocol families (shared-types foundation)

- [x] 1.1 Create `packages/shared-types/src/device-types/port-types.ts` exporting:
  - `PortType` (Zod enum: `'rs485-bus' | 'mqtt-topic' | 'analog-4-20ma'`).
  - `PORT_TYPE_META: Record<PortType, { description: string; addressing: 'index' | 'topic' | 'channel'; defaultMaxCount: number }>`.
  - **Accept**: `import { PortType } from '...'` compiles; `PortType.parse('rs485-bus')` returns `'rs485-bus'`. ~30 LOC.

- [x] 1.2 Create `packages/shared-types/src/device-types/protocol-families.ts` exporting `ProtocolFamily` (Zod enum) with the 7 values from the design. ~20 LOC.

- [x] 1.3 Create `packages/shared-types/src/device-types/schema.ts` exporting `Category`, `DevicePortSchema`, `DefaultSignalSchema`, `DeviceTypeSchema`, and inferred TS types. Include the four category-specific `.superRefine` rules from the design. ~140 LOC.

- [x] 1.4 Create `packages/shared-types/src/device-types/__tests__/schema.spec.ts`:
  - Valid full manifest passes.
  - Each category-specific refinement is exercised (e.g. broker without exactly one `mqtt-topic` port fails; sensor without `defaultSignal` fails; ingest with ports fails).
  - Invalid `iconRef` accent color regex fails.
  - **Accept**: `pnpm --filter @controlai-web/shared-types test schema` green. ~120 LOC, ≥ 18 cases.

## 2. Registry runtime

- [x] 2.1 Create `packages/shared-types/src/device-types/registry.ts` exporting `registerDeviceType`, `getDeviceType`, `listDeviceTypes`, `assertKnownDeviceType`, `validateConnection`. Internal `Map<string, DeviceType>` + duplicate-id error including the prior call site (extract via `new Error().stack`). ~180 LOC.

- [x] 2.2 Create `packages/shared-types/src/device-types/default-data.ts` exporting `defaultNodeData(deviceTypeId: string): NodeData`. Returns a typed object suitable for direct assignment to xyflow `node.data`. ~40 LOC.

- [x] 2.3 Create `packages/shared-types/src/device-types/__tests__/registry.spec.ts`:
  - Register/get/list happy paths.
  - Duplicate-id throws with both call-site hints.
  - `assertKnownDeviceType('missing')` throws an error with `code === 'UNKNOWN_DEVICE_TYPE'`.
  - `listDeviceTypes({ category: 'sensor' })` returns only sensors.
  - **Accept**: pnpm test green. ~100 LOC, ≥ 12 cases.

- [x] 2.4 Create `packages/shared-types/src/device-types/__tests__/validate-connection.spec.ts`:
  - Sensor→Gateway via accepting `rs485-bus` port: ok.
  - Sensor→Gateway with port already at `maxCount`: rejected `CAPACITY_EXCEEDED`.
  - Sensor with `analog-4-20ma` protocol → Gateway with only `rs485-bus` port: rejected `PROTOCOL_MISMATCH`.
  - Broker→Sensor: rejected `INVALID_CATEGORY_PAIR`.
  - Unknown source-typeId: rejected `UNKNOWN_DEVICE_TYPE`.
  - **Accept**: pnpm test green. ~140 LOC, ≥ 15 cases.

## 3. Core (legacy-compat) manifests

- [x] 3.1 Create `packages/shared-types/src/device-types/manifests/core/generic-sensor.ts` — id `core-generic-sensor`, category `sensor`, `defaultSignal { rateMs: 1000, format: 'json', units: 'value', range: { min: 0, max: 100 } }`, `visual { iconRef: 'thermometer', accentColor: '#10b981' }`. ~25 LOC.

- [x] 3.2 Create the five remaining core manifests (`generic-gateway.ts`, `generic-broker.ts`, `generic-ingest.ts`, `generic-tsdb.ts`, `generic-monitoring.ts`) following the same shape. Icons: `router`, `radio-tower`, `arrow-down-to-line`, `database`, `activity`. ~25 LOC each.

- [x] 3.3 Per-manifest snapshot tests under `__tests__/manifests/core.spec.ts`. ~60 LOC total.

## 4. DAEJAK first-batch manifests

- [x] 4.1 Create `packages/shared-types/src/device-types/manifests/daejak/daejak-main-v1.ts` — match the design's example exactly. ~40 LOC.

- [x] 4.2 Create `packages/shared-types/src/device-types/manifests/daejak/daejak-vm.ts`:
  - id `daejak-vm`, category `sensor`, firmwareTypeIds `['DAEJAK_VM']`.
  - `defaultSignal { rateMs: 1000, format: 'json', units: 'V', range: { min: 0, max: 24 } }`.
  - `visual { iconRef: 'gauge', accentColor: '#10b981' }`.
  - No ports (sensor has implicit out). ~30 LOC.

- [x] 4.3 Per-manifest snapshot tests under `__tests__/manifests/daejak.spec.ts`. ~40 LOC.

## 5. Aggregator + contract test

- [x] 5.1 Create `packages/shared-types/src/device-types/index.ts` — side-effect imports for every manifest under `core/` and `daejak/`, then re-exports `schema`, `registry`, `port-types`, `protocol-families`, `default-data`. ~30 LOC.

- [x] 5.2 Create `packages/shared-types/src/device-types/__tests__/aggregator.spec.ts`:
  - Enumerate `manifests/**/*.ts` via `node:fs` (no extra dep) and assert each file's path appears as an `import` line in `index.ts`.
  - After importing `index.ts`, `listDeviceTypes()` must have exactly N entries matching the discovered file count.
  - **Accept**: pnpm test green. ~60 LOC.

- [x] 5.3 Modify `packages/shared-types/src/index.ts` to re-export `./device-types`. Keep existing `./node-types` and `./connection-rules` exports for one minor release (deprecation shim — see task 8).

## 6. NodeConfig: server-side validation + on-read migration

- [x] 6.1 Modify `packages/api/src/routers/nodeConfig.ts`:
  - In `save`: iterate `input.nodes`, assert `node.data.deviceTypeId` is a known type via `assertKnownDeviceType`. On unknown, throw `TRPCError({ code: 'BAD_REQUEST', message: 'Unknown device-type: <id>' })`.
  - In `load`: pre-return, if a node lacks `data.deviceTypeId` but has legacy `data.type ∈ {sensor, gateway, broker, ingest, timescaledb, monitoring}`, set `data.deviceTypeId = 'core-generic-${type}'` (special-case `timescaledb → core-generic-tsdb`). Do NOT persist on read; persistence happens on next user save.
  - ~40 LOC modifications.

- [x] 6.2 Add tests in `packages/api/src/routers/__tests__/nodeConfig.spec.ts`:
  - Save with unknown deviceTypeId rejects.
  - Load with legacy nodes returns deviceTypeId-augmented nodes.
  - **Accept**: pnpm test green. ~80 LOC.

## 7. Canvas: palette, validation, node renderer

- [x] 7.1 Modify `apps/web/components/canvas/node-palette.tsx`:
  - Replace the hardcoded list with `listDeviceTypes()` grouped by category.
  - Render category tabs: `Sensor / Gateway / Broker / Ingest / TSDB / Monitoring`. Default tab: Sensor.
  - Free-text search filters by `displayName + manufacturer + model + firmwareTypeIds.join(' ')`.
  - "Recently used" row pinned to top of the active tab — persisted in `localStorage` keyed by `org/${orgId}`, capped at 8 entries, FIFO eviction.
  - Drag payload becomes `{ deviceTypeId }` instead of `{ type }`.
  - ~180 LOC delta.

- [x] 7.2 Modify `apps/web/components/canvas/canvas.tsx`:
  - On drop, call `useCanvasStore.getState().addNode(payload.deviceTypeId, position)`.
  - `<ReactFlow isValidConnection={...}>` calls `validateConnection({...})` using current edge counts from the store. Provide `connectionLineStyle` change on rejection (red dashed) — uses xyflow's recommended pattern.
  - `onConnect` re-validates server-trip safe: if validation fails (race), drop the edge silently and toast the reason.
  - ~80 LOC delta.

- [x] 7.3 Modify `apps/web/stores/canvas-store.ts`:
  - `addNode(deviceTypeId, position)`: resolves manifest via `assertKnownDeviceType`; seeds `data` via `defaultNodeData(deviceTypeId)`; generates `id = createId()`; pushes to nodes; updates dirty.
  - Drop the prior `addNode(type, position)` signature OR keep as a deprecated wrapper that maps `type → core-generic-${type}` and logs a console.warn (kept until task 8).
  - ~50 LOC delta.

- [x] 7.4 Create `apps/web/components/canvas/nodes/device-node.tsx` — single generic renderer that reads `data.deviceTypeId`, resolves the manifest, renders icon + accent + label + status dot + msgPerSec. The six existing per-category files become 5-line shims importing `DeviceNode` with a static `manifestCategory` prop. ~120 LOC for DeviceNode + ~10 LOC each for shims.

- [x] 7.5 Create `apps/web/components/canvas/nodes/orphan-node.tsx` — read-only orphan renderer with kebab menu (Migrate / Delete). Migrate opens a `Dialog` listing same-category manifests; selecting one calls `useCanvasStore.replaceDeviceType(nodeId, newId)`. ~120 LOC.

- [x] 7.6 Modify the canvas xyflow `nodeTypes` registration to include `'orphan'` mapped to OrphanNode; canvas-store's `load()` flags nodes whose `deviceTypeId` is unresolved as `type: 'orphan'`.

## 8. Apply-planner + connection-rules cleanup

- [x] 8.1 Modify `packages/api/src/lib/apply-planner.ts`:
  - In `iterateCanvasNodes`, replace `node.type === 'broker'` etc. with `getDeviceType(node.data.deviceTypeId)?.category === 'broker'`.
  - Refuse to synthesize a plan when any node is orphaned (`getDeviceType` returns `undefined`): throw `Error('Plan synthesis blocked: orphan device types present')`.
  - ~60 LOC delta.

- [x] 8.2 Modify `apps/web/components/canvas/connection-rules.ts`:
  - Delete `CONNECTION_MATRIX`.
  - Export `isValidConnection` as a thin wrapper that calls `validateConnection` from shared-types — preserved for one minor release as the public canvas API, then removed.
  - ~20 LOC after delta.

- [x] 8.3 Modify `packages/shared-types/src/node-types.ts`:
  - Mark `NODE_TYPES`, `NodeType`, `defaultNodeData(type)` as `@deprecated`. Each emits a console.warn once at first use in non-production.
  - The Zod data schemas (`SensorDataSchema`, etc.) are RETAINED — DeviceNode reads `data.config` against these for back-compat. New manifest-typed nodes set `data.config = {}` and rely on `defaultNodeData(deviceTypeId)`.
  - ~30 LOC delta.

- [x] 8.4 Add a per-app build-time grep gate: `pnpm --filter @controlai-web/web build` succeeds and `pnpm --filter @controlai-web/web run check:deprecated` (new script invoking `rg "NODE_TYPES|CONNECTION_MATRIX"` against `apps/web/src/`) returns zero hits except in the deprecation shims themselves.

## 9. Simulator manifest awareness

- [x] 9.1 Modify `apps/simulator/src/manager.ts`:
  - When loading a gateway's `sensors[]`, attempt to resolve each sensor's manifest via `getDeviceType(sensor.deviceTypeId)`; fall back to `core-generic-sensor` when missing (transitional). Use manifest's `defaultSignal.rateMs` as the floor; honor explicit per-sensor override.
  - Enforce per-device floor `intervalMs >= manifest.constraints.minIntervalMs` (default 100ms).
  - ~40 LOC delta.

- [x] 9.2 Update existing simulator tests to assert manifest resolution path. ~30 LOC.

## 10. UI tests, palette tests, orphan tests

- [x] 10.1 Create `apps/web/components/canvas/__tests__/node-palette.spec.tsx`:
  - Renders 6 category tabs.
  - Default tab Sensor shows ≥ 1 sensor manifest.
  - Search "DAEJAK" filters to only daejak-* manifests.
  - Recently-used row updates on drag-start. ~120 LOC.

- [x] 10.2 Create `apps/web/components/canvas/__tests__/canvas-validation.spec.tsx`:
  - Connecting two sensors fails (no acceptable port-pair).
  - Connecting sensor → gateway succeeds.
  - Exceeding gateway port `maxCount` fails on the (N+1)th edge with a toast containing the rule reason. ~140 LOC.

- [x] 10.3 Create `apps/web/components/canvas/__tests__/orphan-node.spec.tsx`:
  - Loading a NodeConfig with `deviceTypeId: 'missing-foo'` renders OrphanNode.
  - Save button is disabled with tooltip naming the orphan count.
  - Migrate dialog lists same-category manifests; selecting one rewrites the node and re-enables save. ~140 LOC.

## 11. Documentation + research refs

- [x] 11.1 Create `openspec/changes/add-plugin-device-type-registry/research-refs.md` — link to `.slash/workspace/research/device-type-registry-prior-art.md` plus the manifest-authoring how-to (next task).

- [x] 11.2 Create `docs/device-type-authoring.md` — short, vendor-facing guide: "how to add a new device-type manifest." Includes the manifest skeleton, validation expectations, icon/accent conventions, and a checklist (manifest file → import in `index.ts` → snapshot test → run `pnpm test`). ~100 LOC markdown.

- [x] 11.3 Update `apps/web/README.md` to mention `listDeviceTypes()` is the canvas catalog source.

## 12. Validation gate

- [x] 12.1 Run `pnpm -r typecheck` — clean.
- [x] 12.2 Run `pnpm -r test` — clean.
- [x] 12.3 Run `pnpm --filter @controlai-web/web lint` — clean.
- [x] 12.4 Run `openspec validate add-plugin-device-type-registry --strict` — clean.
- [x] 12.5 Manual: drop a `daejak-main-v1` and a `daejak-vm` in a dev SiteGroup; observe the rs485-bus port edge validation and palette search.

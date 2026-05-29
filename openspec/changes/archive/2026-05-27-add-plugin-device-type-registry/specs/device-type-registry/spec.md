# device-type-registry Specification (delta)

## ADDED Requirements

### Requirement: Device-type manifests SHALL be validated by a single Zod schema at registration time

The package `@controlai-web/shared-types` SHALL export `DeviceTypeSchema` (Zod). Every call to `registerDeviceType(manifest)` SHALL call `DeviceTypeSchema.parse(manifest)` and discard any input that fails parsing. The schema SHALL enforce:

- `id` matches `/^[a-z0-9][a-z0-9-]*[a-z0-9]$/` and is unique across the entire registry.
- `category` ∈ `{sensor, gateway, broker, ingest, tsdb, monitoring}`.
- `ports[]` consist only of `DevicePortSchema`-shaped objects whose `portType` ∈ `{rs485-bus, mqtt-topic, analog-4-20ma}` and whose `acceptsProtocols[]` are drawn from the canonical `ProtocolFamily` list.
- `visual.iconRef` is a non-empty string; `visual.accentColor` matches `/^#[0-9a-fA-F]{6}$/`.
- Category-specific refinements: `sensor` MUST have `defaultSignal`; `broker` MUST have exactly one `mqtt-topic` port and no `defaultSignal`; `ingest|tsdb|monitoring` MUST have no ports and no `defaultSignal`; `gateway` MUST have at least one `rs485-bus` OR `mqtt-topic` port.

#### Scenario: Valid manifest registers exactly once

- **WHEN** a TypeScript module under `packages/shared-types/src/device-types/manifests/**/*.ts` calls `registerDeviceType({ id: 'daejak-vm', category: 'sensor', ports: [], defaultSignal: { rateMs: 1000, format: 'json', units: 'V', range: { min: 0, max: 24 } }, visual: { iconRef: 'gauge', accentColor: '#10b981' }, ...required fields })`
- **THEN** `getDeviceType('daejak-vm')` SHALL return the parsed manifest
- **AND** `listDeviceTypes({ category: 'sensor' })` SHALL include the manifest
- **AND** no other registry mutation SHALL occur

#### Scenario: Manifest fails schema validation

- **WHEN** a manifest is registered with `visual.accentColor: 'blue'` (not a hex literal)
- **THEN** `registerDeviceType` SHALL throw a `ZodError` whose `.issues[0].path` references `['visual', 'accentColor']`
- **AND** the manifest SHALL NOT be added to the registry
- **AND** `getDeviceType` for the offending id SHALL return `undefined`

#### Scenario: Duplicate manifest id is rejected loudly

- **WHEN** a second module calls `registerDeviceType({ id: 'daejak-vm', ... })` after the first registration has succeeded
- **THEN** `registerDeviceType` SHALL throw `Error` whose message contains `Duplicate device-type id: daejak-vm` and a hint referencing the prior registration's call site
- **AND** the previously-registered manifest SHALL remain authoritative
- **AND** package initialization SHALL fail (uncaught at import time), preventing the app from booting with a corrupted registry

#### Scenario: Sensor manifest without defaultSignal is rejected

- **WHEN** a manifest with `category: 'sensor'` omits `defaultSignal`
- **THEN** `DeviceTypeSchema.parse` SHALL throw `ZodError` mentioning the missing `defaultSignal` field under the sensor-category refinement
- **AND** `registerDeviceType` SHALL NOT add the manifest

#### Scenario: Broker manifest with two mqtt-topic ports is rejected

- **WHEN** a manifest with `category: 'broker'` declares `ports: [{ portType: 'mqtt-topic', ... }, { portType: 'mqtt-topic', ... }]`
- **THEN** `DeviceTypeSchema.parse` SHALL throw `ZodError` whose message references the broker refinement and the count of `mqtt-topic` ports
- **AND** `registerDeviceType` SHALL NOT add the manifest

---

### Requirement: Connection validation SHALL be derived from manifests, not from a hardcoded matrix

`validateConnection(args)` exported from `@controlai-web/shared-types/device-types/registry` SHALL be the single source of truth for whether a candidate edge between two canvas nodes is allowed. The canvas client SHALL call this function from xyflow's `isValidConnection` prop during drag, AND from `onConnect` immediately before mutating store state. The server-side `nodeConfig.save` procedure SHALL NOT independently validate edges; this responsibility lives in the canvas.

`validateConnection` SHALL return `{ ok: true }` only when ALL of the following hold:

1. Both `sourceTypeId` and `targetTypeId` resolve to manifests in the registry.
2. The source's selected port (or implicit `out` for sensors with no declared ports) has at least one `acceptsProtocols` overlap with at least one of the target's port's `acceptsProtocols`.
3. `sourceCurrentChildren + 1 ≤ source.port.maxCount`.
4. The source and target categories form a permitted pair derived from manifests (no manifest-pair allow-list constant exists; the check is `target.ports[...].acceptsProtocols ∩ source.outProtocols ≠ ∅`).

#### Scenario: DAEJAK_VM connects to DAEJAK_MAIN within capacity

- **GIVEN** a canvas with one `daejak-main-v1` node, one `daejak-vm` node, and zero existing edges from `daejak-main-v1.rs485-1`
- **WHEN** `validateConnection({ sourceTypeId: 'daejak-vm', sourcePortId: undefined, sourceCurrentChildren: 0, targetTypeId: 'daejak-main-v1', targetPortId: 'rs485-1', targetCurrentParents: 0 })` is invoked
- **THEN** the result SHALL be `{ ok: true }`

#### Scenario: Capacity exceeded

- **GIVEN** 16 edges already terminate at `daejak-main-v1.rs485-1` (its `maxCount` is 16)
- **WHEN** `validateConnection` is invoked with the same target port and `targetCurrentParents: 16`
- **THEN** the result SHALL be `{ ok: false, code: 'CAPACITY_EXCEEDED', reason: <human-readable string referencing both 16 and rs485-1> }`

#### Scenario: Protocol mismatch

- **GIVEN** a hypothetical sensor manifest whose `defaultSignal.format` and outProtocols are `analog-4-20ma`
- **WHEN** `validateConnection` is invoked against `daejak-main-v1.rs485-1` (accepts only `modbus-rtu`, `rs485-serial-generic`)
- **THEN** the result SHALL be `{ ok: false, code: 'PROTOCOL_MISMATCH', reason: ... }`

#### Scenario: Unknown source device-type

- **WHEN** `validateConnection({ sourceTypeId: 'unknown-foo', ... })` is invoked
- **THEN** the result SHALL be `{ ok: false, code: 'UNKNOWN_DEVICE_TYPE', reason: 'No manifest registered for id "unknown-foo".' }`

---

### Requirement: Canvas palette SHALL surface manifests grouped by category, searchable, with recently-used pinning

`apps/web/components/canvas/node-palette.tsx` SHALL render a category-tabbed palette whose entries are sourced from `listDeviceTypes()`. The palette SHALL provide:

- Tabs in the order `Sensor / Gateway / Broker / Ingest / TSDB / Monitoring`; Sensor active by default.
- A free-text search input filtering by `displayName + manufacturer + model + firmwareTypeIds`.
- A "Recently used" row pinned above the active tab's grid, showing up to 8 most-recent device-types the user has dragged onto the canvas, FIFO eviction; persisted in `localStorage` under key `controlai:palette:recent:${orgId}`.

#### Scenario: Default palette shows sensor manifests

- **WHEN** the user opens the canvas with a registry containing `core-generic-sensor`, `daejak-vm`, `core-generic-gateway`, `daejak-main-v1`, and `core-generic-broker`
- **THEN** the active tab SHALL be `Sensor`
- **AND** the visible entries SHALL include exactly `core-generic-sensor` and `daejak-vm`
- **AND** no entries from other categories SHALL be visible until the user switches tabs

#### Scenario: Search across manufacturer

- **WHEN** the user types `daejak` into the palette search
- **THEN** the visible entries SHALL include `daejak-vm` and `daejak-main-v1` (across tabs, with a category-prefix label on each)
- **AND** entries whose `displayName + manufacturer + model + firmwareTypeIds` contain neither `daejak` nor `DAEJAK` SHALL be hidden

#### Scenario: Recently-used pin updates on drag

- **WHEN** the user drags `daejak-main-v1` onto the canvas for the first time
- **THEN** `daejak-main-v1` SHALL appear as the first entry in the "Recently used" row
- **AND** `localStorage` key `controlai:palette:recent:${orgId}` SHALL persist an array whose first element is `'daejak-main-v1'`

---

### Requirement: Canvas SHALL enforce manifest-based connection rules at drag time

`apps/web/components/canvas/canvas.tsx` SHALL pass an `isValidConnection` prop to `<ReactFlow>` that calls `validateConnection` from the registry. When the result is `{ ok: false, ... }`, xyflow's connection line SHALL render in a rejected style and the drop SHALL NOT create an edge. The `onConnect` handler SHALL re-call `validateConnection` defensively before mutating the canvas store; on rejection it SHALL silently drop the edge and toast `reason` via the existing `useToast` hook.

#### Scenario: Drag-time validation prevents invalid edge

- **GIVEN** a canvas with two `daejak-vm` (sensor) nodes
- **WHEN** the user drags an edge from one sensor to the other
- **THEN** xyflow's `isValidConnection` SHALL return `false` while the drag is in progress
- **AND** releasing the mouse SHALL NOT create an edge
- **AND** the rejected connection-line style SHALL have been visible during the drag

#### Scenario: Defensive re-validation on connect

- **WHEN** a race condition causes a connection to pass drag-time validation but fail at `onConnect` (e.g. another edge filled the capacity in between)
- **THEN** `onConnect` SHALL drop the edge silently
- **AND** the toast SHALL display the rejection reason from `validateConnection`

---

### Requirement: Orphan device-types SHALL be surfaced with a Migrate/Delete UX and block save/apply

When `nodeConfig.load` returns a NodeConfig containing a node whose `data.deviceTypeId` is not in the registry, the canvas SHALL render that node as an `OrphanNode` component. The orphan node SHALL display a "Unknown device type: `<id>`" badge and a kebab menu offering **Migrate** (opens a dialog listing same-category manifests; picking one replaces the node's `deviceTypeId` and clears its orphan state) and **Delete**. While any orphan is present:

- The canvas save button SHALL be disabled, with a tooltip naming the count of orphaned nodes.
- The Apply button SHALL be disabled.
- `apply-planner.synthesizePlan` SHALL throw `Error('Plan synthesis blocked: orphan device types present')` if called.

#### Scenario: Orphan detected on load

- **GIVEN** a persisted NodeConfig containing `{ id: 'n1', data: { deviceTypeId: 'removed-old-type' } }` and the registry does NOT contain `removed-old-type`
- **WHEN** the user opens the canvas
- **THEN** node `n1` SHALL render with the OrphanNode component
- **AND** the badge SHALL contain the literal text `removed-old-type`
- **AND** the Save button SHALL be disabled

#### Scenario: Migrate clears orphan state

- **GIVEN** an orphan node as above
- **WHEN** the user opens the kebab menu, clicks Migrate, selects `core-generic-sensor` from the dialog, and confirms
- **THEN** the node's `data.deviceTypeId` SHALL become `'core-generic-sensor'`
- **AND** the node SHALL re-render with the standard `DeviceNode` component
- **AND** the canvas Save button SHALL be enabled (assuming no other orphans remain)

---

### Requirement: NodeConfig SHALL be migrated on read from legacy `type` to `deviceTypeId`

`packages/api/src/routers/nodeConfig.ts`'s `load` procedure SHALL, before returning, walk every node in the persisted JSON; for any node lacking `data.deviceTypeId` but having a legacy `node.type ∈ {sensor, gateway, broker, ingest, timescaledb, monitoring}`, it SHALL set `data.deviceTypeId` from the mapping table:

```
sensor       → core-generic-sensor
gateway      → core-generic-gateway
broker       → core-generic-broker
ingest       → core-generic-ingest
timescaledb  → core-generic-tsdb
monitoring   → core-generic-monitoring
```

The augmentation SHALL be in-memory only; the persisted row SHALL NOT be rewritten on load. Persistence happens on the user's next `save`, which SHALL pass server-side validation because the `core-generic-*` manifests are registered.

#### Scenario: Legacy node augmented on load

- **GIVEN** a NodeConfig row whose `nodes` JSON contains `{ id: 'n1', type: 'sensor', data: { label: 'temp1' } }` and no `data.deviceTypeId`
- **WHEN** the canvas calls `nodeConfig.load`
- **THEN** the response SHALL contain `{ id: 'n1', type: 'sensor', data: { label: 'temp1', deviceTypeId: 'core-generic-sensor' } }`
- **AND** the underlying database row SHALL be unchanged

#### Scenario: Save persists augmented form

- **WHEN** the user saves the canvas after the on-load augmentation has occurred (and they did not modify the node otherwise)
- **THEN** the persisted NodeConfig row SHALL contain `data.deviceTypeId: 'core-generic-sensor'`
- **AND** subsequent loads SHALL skip the augmentation step for this node

---

### Requirement: Server-side `nodeConfig.save` SHALL reject unknown device-type IDs

`packages/api/src/routers/nodeConfig.ts`'s `save` procedure SHALL, before persisting, iterate `input.nodes` and call `assertKnownDeviceType(node.data.deviceTypeId)` for each node. On the first unknown id, it SHALL throw `TRPCError({ code: 'BAD_REQUEST', message: 'Unknown device-type: <id>' })`. No partial write SHALL occur.

#### Scenario: Save with unknown deviceTypeId rejected

- **GIVEN** a NodeConfig save request whose nodes include `{ data: { deviceTypeId: 'fabricated-foo' } }` and the registry does NOT contain `fabricated-foo`
- **WHEN** `nodeConfig.save` is invoked
- **THEN** the procedure SHALL throw `TRPCError` with `code: 'BAD_REQUEST'` and a message containing `'fabricated-foo'`
- **AND** the existing persisted NodeConfig SHALL be unchanged

#### Scenario: Save with all-known IDs succeeds

- **WHEN** every node's `deviceTypeId` is registered
- **THEN** the procedure SHALL persist the new version per existing semantics (creates a new draft or updates the active draft per current behavior)

---

### Requirement: Apply-planner SHALL resolve manifests by deviceTypeId and refuse to plan with orphans

`packages/api/src/lib/apply-planner.ts`'s `iterateCanvasNodes` (and any internal helpers that branch on node category) SHALL resolve `node.data.deviceTypeId` via `getDeviceType`. The resulting `manifest.category` SHALL drive op synthesis (broker → createTenant/createSite; ingest → updateIngest; tsdb → updateTsdb). If any node's `deviceTypeId` cannot be resolved, `synthesizePlan` SHALL throw `Error('Plan synthesis blocked: orphan device types present')` and synthesize no ops.

#### Scenario: Plan synthesis succeeds with manifest-resolved categories

- **GIVEN** a NodeConfig containing one broker (`core-generic-broker`), one ingest (`core-generic-ingest`), one TSDB (`core-generic-tsdb`) node, all with valid edges
- **WHEN** `synthesizePlan` is invoked
- **THEN** the resulting plan SHALL contain `createTenant`, `createSite`, `updateIngest`, and `updateTsdb` ops in the existing order
- **AND** each op's `nodeId` SHALL match the originating canvas node ID

#### Scenario: Plan synthesis blocked by orphan

- **GIVEN** a NodeConfig containing one orphan node with `deviceTypeId: 'removed-foo'`
- **WHEN** `synthesizePlan` is invoked
- **THEN** the function SHALL throw `Error` whose message contains `'Plan synthesis blocked'` and the count of orphaned nodes
- **AND** no ops SHALL be returned

---

### Requirement: Manifest aggregator SHALL exhaustively include every manifest file via side-effect import

`packages/shared-types/src/device-types/index.ts` SHALL contain one side-effect `import './manifests/<vendor>/<file>'` line per `.ts` file under `manifests/**/*.ts`. A contract test SHALL enumerate that file tree and assert each path appears as an import in `index.ts`; the test SHALL fail when a new manifest is added without its import being registered.

#### Scenario: New manifest without aggregator import fails the contract test

- **GIVEN** a new file `packages/shared-types/src/device-types/manifests/daejak/daejak-tm.ts` exists
- **AND** `packages/shared-types/src/device-types/index.ts` does NOT contain `import './manifests/daejak/daejak-tm'`
- **WHEN** the aggregator contract test runs
- **THEN** the test SHALL fail with a message naming `daejak-tm.ts` as missing from the aggregator

#### Scenario: After import is added, contract test passes

- **WHEN** the import line is added to `index.ts` and the test re-runs
- **THEN** the test SHALL pass
- **AND** `listDeviceTypes()` SHALL include the newly-registered manifest

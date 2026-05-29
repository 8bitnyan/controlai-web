# Change: Add plugin-style device-type registry

## Why

Today controlai-web's canvas knows exactly **six** node types — `sensor`, `gateway`, `broker`, `ingest`, `timescaledb`, `monitoring` — hardcoded as a Zod discriminated union in `packages/shared-types/src/node-types.ts` and a static `CONNECTION_MATRIX` constant in `packages/shared-types/src/connection-rules.ts`. Every per-type default (signal rate, signal format, label) lives inline in `defaultNodeData()`. Every connection rule is a flat source→target lookup.

This shape cannot express the real device catalog the operator is bringing to the product:

1. **Multiple sensor / gateway models per category.** A `DAEJAK_MAIN v1.2.0` gateway is not interchangeable with a future LoRaWAN gateway — they accept different protocols, have different child capacity, expose different ports. The canvas must let operators drop "the actual board they bought," not a generic `sensor`.
2. **Per-type connection capacity.** Some gateways accept up to 8 sensors on a single RS-485 bus; some hardware accepts exactly 2; an MQTT broker accepts unbounded mqtt-topic publishers. The current binary "is this source→target pair allowed?" answer cannot represent capacity.
3. **Typed ports.** A device may host both an RS-485 multi-drop bus and a 4-20mA analog input bank. Whether a candidate child is connectable depends not just on the parent's category but on which physical/logical port is being used.
4. **Open-ended catalog growth.** The operator already has a list of sensor and gateway combinations they intend to ship. Adding each one as a code change in `shared-types` plus a new branch in `defaultNodeData()` plus a new entry in `CONNECTION_MATRIX` is unsustainable past ~10 types.

The user explicitly requested: **plugin-style from day one** so that adding a new device type means dropping one TypeScript manifest file, not editing six.

## What Changes

This change introduces a new capability **`device-type-registry`** — an in-repo, TypeScript-module-based registry where each device type is one `.ts` file that calls `registerDeviceType()` at module load time. A shared Zod `DeviceTypeSchema` validates every manifest. The canvas, palette, connection validator, simulator, and apply-planner all consume the registry instead of the static enum.

This change **does not** introduce a database-backed catalog, an admin UI for type creation, or runtime hot-reload. Those are explicitly deferred to a future spec. v1 ships an in-repo registry with the existing six canvas node types re-expressed as manifests plus the first batch of real DAEJAK device-type manifests.

- **NEW CAPABILITY SPEC** `device-type-registry` — covers manifest schema, registry loader, validation timing on the canvas, palette consumption, orphan-type handling.

- **NEW PACKAGE-INTERNAL MODULE** `packages/shared-types/src/device-types/`:
  - `schema.ts` — exports `DeviceTypeSchema` (Zod), `type DeviceType = z.infer<...>`, `type DevicePort`, `type PortType`, `type ProtocolFamily`, and the `Category` enum (`sensor | gateway | broker | ingest | tsdb | monitoring`).
  - `registry.ts` — exports `registerDeviceType(manifest: DeviceType): void`, `getDeviceType(id: string): DeviceType | undefined`, `listDeviceTypes(filter?: { category?: Category }): DeviceType[]`, `assertKnownDeviceType(id: string): DeviceType` (throws orphan error), and `validateConnection({ sourceId, sourceTypeId, sourcePortId, targetId, targetTypeId, targetPortId }): ConnectionValidationResult`.
  - `port-types.ts` — exports the v1 port-type union: `'rs485-bus' | 'mqtt-topic' | 'analog-4-20ma'`. Each has a Zod-validated metadata block describing addressing, fan-out semantics, and accepted protocols.
  - `protocol-families.ts` — exports the v1 protocol union: `'mqtt' | 'modbus-rtu' | 'modbus-tcp' | 'lorawan' | 'analog-4-20ma' | 'analog-0-10v' | 'rs485-serial-generic'`.
  - `index.ts` — `import './manifests/*'` side-effect-only module that triggers all manifest registrations at package init time.

- **NEW MANIFEST DIRECTORY** `packages/shared-types/src/device-types/manifests/`:
  - `core/` — six manifests re-expressing today's canvas categories with no behavior change:
    - `generic-sensor.ts`, `generic-gateway.ts`, `generic-broker.ts`, `generic-ingest.ts`, `generic-tsdb.ts`, `generic-monitoring.ts`.
  - `daejak/` — first real-hardware manifests informed by the operator's pasted CLI output:
    - `daejak-main-v1.ts` — gateway category, ports: `[{ id: 'rs485-1', portType: 'rs485-bus', maxCount: 16, acceptsProtocols: ['modbus-rtu', 'rs485-serial-generic'] }, { id: 'uplink-mqtt', portType: 'mqtt-topic', maxCount: 1, acceptsProtocols: ['mqtt'] }]`, firmwareTypeIds: `['DAEJAK_MAIN']`, icon: `'router'`, accent: `'#3b82f6'`.
    - `daejak-vm.ts` — sensor category, accepted-parent ports: `['rs485-bus']`, firmwareTypeIds: `['DAEJAK_VM']`, icon: `'gauge'`, accent: `'#10b981'`.

- **REPLACED CONSTANT** `packages/shared-types/src/connection-rules.ts`'s `CONNECTION_MATRIX` SHALL be removed. The canvas client SHALL call `validateConnection()` from the registry, which derives allowed pairings from manifest `ports[]` + `category` rules.

- **REPLACED FACTORY** `defaultNodeData(type: NodeType)` in `node-types.ts` SHALL be replaced by `defaultNodeData(deviceTypeId: string)` that reads the manifest's `defaultSignal` + `visual` + `config` fields.

- **MODIFIED COMPONENT** `apps/web/components/canvas/node-palette.tsx` — replaces its hardcoded `NODE_TYPES` list with `listDeviceTypes()`, grouped by category. Category tabs (Sensor / Gateway / Broker / Ingest / TSDB / Monitoring), free-text search, recently-used row pinned to top of the active tab.

- **MODIFIED COMPONENT** `apps/web/components/canvas/canvas.tsx` — `onConnect` handler routes through `validateConnection()`; xyflow `isValidConnection` prop is wired to the same call so invalid edges are rejected during drag.

- **MODIFIED NODE COMPONENTS** `apps/web/components/canvas/nodes/*` — each becomes a thin wrapper over a `DeviceNode` component that reads its visual + label + status fields from the manifest associated with the node's `deviceTypeId`. The six existing files stay as category-default renderers, but specialized renderers can register via the manifest's `visual.componentRef` field.

- **MODIFIED FILES** referencing `NodeType` or `CONNECTION_MATRIX`:
  - `apps/web/components/canvas/connection-rules.ts` — becomes a re-export shim of `validateConnection`, with a deprecation comment.
  - `packages/api/src/lib/apply-planner.ts` — `iterateCanvasNodes()` resolves `node.data.deviceTypeId` against the registry; broker/ingest/tsdb operations dispatch on `manifest.category`, not on the legacy `type` string.
  - `apps/simulator/src/manager.ts` — gateway loading resolves children's `deviceTypeId` to look up `defaultSignal.rateMs` / `defaultSignal.format`; in spec 2 this becomes per-Device-row.

- **ORPHAN-TYPE UI** — when a NodeConfig contains a node referencing a `deviceTypeId` not in the registry, that node SHALL render as read-only with a "Unknown device type" badge and a kebab menu offering **Migrate** (pick a replacement from the registry) or **Delete**. Canvas save is blocked while any node is orphaned. This mirrors the existing Site-orphan handling in `sites-client.tsx`.

- **NEW TESTS**:
  - Unit (Vitest, `packages/shared-types`): `schema.spec.ts`, `registry.spec.ts`, `validate-connection.spec.ts`, `port-types.spec.ts`. Per-manifest snapshot tests for all `core/*` and `daejak/*` files.
  - Integration (`packages/api`): apply-planner runs against a NodeConfig containing manifest IDs and produces equivalent ops to the legacy enum path.
  - UI (Vitest + Testing Library, `apps/web`): palette renders manifests grouped by category; search filters by displayName / manufacturer; orphan node displays the migrate/delete menu.
  - Contract test: every manifest under `manifests/**/*.ts` is registered exactly once on import side-effect.

## Impact

- **Affected specs**: NEW capability `device-type-registry`. No modifications to existing specs.
- **Affected code**:
  - `packages/shared-types/src/node-types.ts` — `NODE_TYPES`, `NodeType`, per-node data schemas, `defaultNodeData` ALL replaced or shimmed. Public re-exports preserved as deprecated shims to keep apps/web compiling during incremental rollout.
  - `packages/shared-types/src/connection-rules.ts` — `CONNECTION_MATRIX` removed; `isValidConnection()` becomes a re-export shim of `validateConnection()`.
  - `apps/web/components/canvas/**/*` — palette, canvas, every node component updated to read manifests.
  - `apps/web/stores/canvas-store.ts` — no schema change, but its `addNode()` helper accepts `deviceTypeId` instead of `type`.
  - `packages/api/src/lib/apply-planner.ts` — node-iteration resolves manifests.
  - `packages/api/src/routers/nodeConfig.ts` — server-side `save` validates every node's `deviceTypeId` against the registry; rejects unknown IDs.
  - `apps/simulator/src/manager.ts` — minor change to resolve manifests for `defaultSignal`.
- **Affected user UX**:
  - Canvas palette gains category tabs + search + recently-used.
  - Dropping a node now spawns a manifest-typed node (visual icon + accent come from manifest, not category).
  - Invalid connections rejected at drag-time with a tooltip describing the rule ("DAEJAK_MAIN.rs485-1 has 8 sensors; cap is 16. OK" vs "DAEJAK_MAIN.uplink-mqtt accepts only mqtt; rs485 sensor cannot connect.").
- **Non-goals (explicitly out of scope, deferred)**:
  - DB-stored manifests, admin UI for manifest authoring, hot-reload.
  - Firmware-side reality (this spec only models the cloud catalog).
  - Cert rotation, multi-tenant manifest namespacing.
  - Manifest versioning beyond `firmwareVersion` declared in the `datasheet` field.
- **Risk surface**:
  - Existing live SiteGroups have NodeConfig rows persisting `type: 'sensor' | 'gateway' | ...`. The deploy MUST run a one-time NodeConfig migration that maps each legacy `type` to a `core/generic-{type}` manifest's `deviceTypeId`. Migration is idempotent (skips rows already migrated).
  - Manifest registration is import-time. Misregistering (e.g. duplicate `id`) MUST fail loudly at package init, before any consumer reads the registry.

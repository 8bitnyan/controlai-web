# device-lifecycle Specification (delta)

## ADDED Requirements

### Requirement: Every canvas node SHALL have a corresponding Device row with an immutable device_key

The Prisma `Device` model SHALL be the authoritative record for every physical-or-logical entity dropped on the canvas. For each entry in a SiteGroup's NodeConfig `nodes[]`, there SHALL be exactly one `Device` row with matching `siteGroupId` and `canvasNodeId`. The `Device.deviceKey` column (CUID) is the primary key and is IMMUTABLE for the lifetime of the row; no procedure, migration, or admin action defined in this spec or any future spec SHALL update it.

#### Scenario: Canvas drop creates Device row

- **WHEN** a user drops a node onto the canvas and `nodeConfig.save` succeeds
- **THEN** the server SHALL invoke `device.create({ siteGroupId, canvasNodeId, deviceTypeId, ... })`
- **AND** a new `Device` row SHALL be persisted with `deviceKey = createId()`, `shadowUuid = deviceKey`, `registrationState = 'UNREGISTERED'`, `simulationDesired = true`, `realUuid = null`
- **AND** the canvas client SHALL receive the row and store it in `useCanvasStore.nodeDevices` keyed by `canvasNodeId`

#### Scenario: Device row creation fails — canvas surfaces a pending state

- **GIVEN** `nodeConfig.save` succeeded but `device.create` failed (e.g. DB write timeout)
- **WHEN** the canvas re-renders the affected node
- **THEN** the node SHALL show a "Device row pending — Retry" overlay
- **AND** the canvas store SHALL NOT contain a Device row for that canvasNodeId
- **AND** clicking Retry SHALL re-invoke `device.create` with the same payload

#### Scenario: device_key is never updated by registration

- **GIVEN** a Device row in state `UNREGISTERED` with `deviceKey = 'ck0001'`, `shadowUuid = 'ck0001'`, `realUuid = null`
- **WHEN** spec 3's registration handshake completes successfully and sets `realUuid = '2C004A001351353230363438'`
- **THEN** the row's `deviceKey` SHALL still be `'ck0001'`
- **AND** the row's `shadowUuid` SHALL still be `'ck0001'`
- **AND** the row's `realUuid` SHALL be `'2C004A001351353230363438'`

---

### Requirement: Device registrationState SHALL follow a strict state machine

The `Device.registrationState` enum has four values (`UNREGISTERED`, `REGISTERING`, `REGISTERED`, `ORPHANED`) and the database SHALL only permit the following transitions:

- `UNREGISTERED → REGISTERING` (only via spec 3's registration initiator)
- `REGISTERING → REGISTERED` (only via spec 3's registration commit)
- `REGISTERING → UNREGISTERED` (registration abort or timeout)
- `UNREGISTERED → ORPHANED` (via `device.delete` while unregistered AND user chose soft-archive instead of hard delete)
- `REGISTERED → ORPHANED` (via `device.delete` on a registered device)

`device.update` SHALL refuse any patch that attempts to set `registrationState` directly; the field is mutated exclusively through `device.create`, `device.delete`, and spec 3's procedures.

#### Scenario: device.update rejects direct registrationState changes

- **WHEN** a caller invokes `device.update({ deviceKey, patch: { registrationState: 'REGISTERED' } })`
- **THEN** Zod validation SHALL strip the field (it is not part of the patch schema)
- **AND** the `Device` row SHALL be unchanged

#### Scenario: device.delete soft-archives a REGISTERED device

- **GIVEN** a Device row in state `REGISTERED`
- **WHEN** `device.delete({ deviceKey })` is invoked
- **THEN** the row SHALL be UPDATED to `registrationState = 'ORPHANED'`
- **AND** the row SHALL NOT be physically deleted
- **AND** an `AuditLog` row SHALL be written with action `device.soft-archive` and metadata containing the prior `realUuid`

#### Scenario: device.delete hard-deletes an UNREGISTERED device

- **GIVEN** a Device row in state `UNREGISTERED`
- **WHEN** `device.delete({ deviceKey })` is invoked
- **THEN** the row SHALL be physically deleted from the database
- **AND** an `AuditLog` row SHALL be written with action `device.hard-delete`

---

### Requirement: Config edits SHALL be blocked once a device is registered

`device.update` SHALL reject patches that modify `config` or `portBindings` when `registrationState !== 'UNREGISTERED'`. The `label` and `simulationDesired` fields remain editable in all states.

#### Scenario: Config edit on registered device rejected

- **GIVEN** a Device row in state `REGISTERED`
- **WHEN** `device.update({ deviceKey, patch: { config: { signal: { rateMs: 500 } } } })` is invoked
- **THEN** the procedure SHALL throw `TRPCError({ code: 'FAILED_PRECONDITION', message: <Korean message indicating the device must be re-registered via ops portal> })`
- **AND** the `Device.config` SHALL be unchanged

#### Scenario: Label edit on registered device allowed

- **WHEN** `device.update({ deviceKey, patch: { label: 'temp-1F-east' } })` is invoked on a `REGISTERED` row
- **THEN** the procedure SHALL succeed
- **AND** the row's `config.label` (or equivalent label field) SHALL be updated

---

### Requirement: Sensors SHALL be promoted from Gateway.sensors JSONB to first-class Device rows

A migration script `migrate-sensors-to-devices.ts` SHALL be provided. For every existing `Gateway` row with `sensors` JSONB non-empty:

1. Ensure a `Device` row exists for the Gateway itself (creating one with `deviceTypeId = 'core-generic-gateway'` if absent; `registrationState = 'REGISTERED'` when the Gateway has all three PEMs encrypted, else `'UNREGISTERED'`; `realUuid = gateway.clientId` when it matches the STM32 24-hex pattern).
2. For each `sensor` in `gateway.sensors[]`, create a `Device` row with `parentDeviceKey = gateway.deviceKey`, `canvasNodeId = '<gatewayCanvasNodeId>:sensor:<sensor.id>'`, `deviceTypeId = 'core-generic-sensor'`, `registrationState = <same as gateway>`, `config = { signal: { rateMs: sensor.intervalMs, ... } }`.
3. Set `Gateway.deviceKey` to the corresponding Device row's `deviceKey`.

The migration SHALL be idempotent: re-running with no new data SHALL produce zero row creations and zero updates. The migration SHALL write `AuditLog` rows with action `device.migrated` and metadata `{ gatewayId, sensorCount, createdDeviceCount, skipped }`.

The legacy `Gateway.sensors` JSONB column SHALL remain in the schema for one minor release after this change deploys; spec follow-up MAY drop it.

#### Scenario: Migration creates Device rows for all sensors

- **GIVEN** a Gateway row with `id = 'gw1'`, `sensors = [{ id: 's1', intervalMs: 1000 }, { id: 's2', intervalMs: 500 }]`, three encrypted PEM fields, `clientId = '2C004A001351353230363438'`
- **WHEN** `migrate-sensors-to-devices.ts` is run
- **THEN** the database SHALL contain a Device row with `deviceTypeId = 'core-generic-gateway'`, `realUuid = '2C004A001351353230363438'`, `registrationState = 'REGISTERED'`, linked to gw1 via `Gateway.deviceKey`
- **AND** the database SHALL contain two more Device rows with `parentDeviceKey = <gateway deviceKey>`, `deviceTypeId = 'core-generic-sensor'`, `registrationState = 'REGISTERED'`, distinct `deviceKey` values, `config.signal.rateMs ∈ {1000, 500}`

#### Scenario: Migration is idempotent

- **GIVEN** the migration in the prior scenario has run once
- **WHEN** the migration is run a second time with no data changes
- **THEN** zero Device rows SHALL be created
- **AND** zero Device rows SHALL be updated
- **AND** zero `AuditLog` rows with action `device.migrated` SHALL be written (the script logs "skipped: true" but does not produce audit rows for no-ops)

---

### Requirement: Simulation toggle SHALL operate at SiteGroup level with per-Device override

The canvas toolbar SHALL include a `<SimulationToggle />` button bound to a SiteGroup-aggregate `simulationDesired` state. Toggling it SHALL invoke `device.setSiteGroupSimulation({ siteGroupId, desired })` which writes the boolean to every Device row in that SiteGroup AND posts `POST /sitegroups/:siteGroupId/simulation` to the simulator.

Individual Devices retain a per-Device `simulationDesired` field that takes precedence: a Device with `simulationDesired = false` does NOT publish, regardless of the SiteGroup toggle. The toolbar button SHALL render a small dot indicator when any Device's `simulationDesired` differs from the SiteGroup aggregate.

#### Scenario: SiteGroup toggle bulk-updates all Devices

- **GIVEN** a SiteGroup with 5 Devices, all `simulationDesired = true`
- **WHEN** the user clicks the toolbar toggle to OFF
- **THEN** the server SHALL update all 5 Device rows to `simulationDesired = false`
- **AND** the simulator's reconciliation pass within 5 seconds SHALL halt all 5 publishers
- **AND** an `AuditLog` row SHALL be written with action `device.bulk-simulation-toggle`, metadata `{ siteGroupId, desired: false, affectedCount: 5 }`

#### Scenario: Per-Device override survives SiteGroup toggle

- **GIVEN** a SiteGroup with 5 Devices, 4 with `simulationDesired = true` and 1 (deviceKey='ckX') with `simulationDesired = false`
- **WHEN** the user clicks the SiteGroup toolbar toggle to ON
- **THEN** the server SHALL update all 5 Device rows to `simulationDesired = true`
- **AND** ckX SHALL now also publish — the SiteGroup toggle overrides the per-Device value because it issues a bulk write
- **AND** subsequent per-Device toggles SHALL again override

#### Scenario: Toolbar dot indicates divergence

- **GIVEN** a SiteGroup with 5 Devices, 4 with `simulationDesired = true` and 1 with `simulationDesired = false`
- **WHEN** the canvas renders the toolbar
- **THEN** the toggle SHALL show ON (aggregate majority) with a small amber dot indicating "1 device differs from group"

---

### Requirement: Simulator SHALL reconcile from Device rows, not Gateway JSONB

`apps/simulator/src/manager.ts` SHALL resolve gateway children via `Device.findMany({ where: { siteGroupId, simulationDesired: true } })` grouped by `parentDeviceKey`. The legacy `Gateway.sensors` JSONB path SHALL be used only as a fallback when a Gateway has zero matching Device children; in that case the simulator SHALL log a `sim-falling-back-to-jsonb` event.

#### Scenario: Simulator picks up newly-created Device

- **GIVEN** a fresh canvas drop creates a Device row with `parentDeviceKey = <gateway deviceKey>`, `simulationDesired = true`, `config.signal.rateMs = 1000`
- **WHEN** the simulator's next reconciliation pass runs (within 5 seconds)
- **THEN** the simulator SHALL spawn a publisher for that Device at 1Hz
- **AND** NDATA messages for that Device SHALL be observable on the broker within 6 seconds of drop

#### Scenario: Simulator halts a Device when simulationDesired flips false

- **GIVEN** a publishing Device with `simulationDesired = true`
- **WHEN** `device.update({ deviceKey, patch: { simulationDesired: false } })` is invoked
- **THEN** the simulator SHALL halt that Device's publisher within 1 publishing interval (≤ 1 second for a 1Hz Device)
- **AND** no NDATA messages SHALL be published for that Device after the halt

---

### Requirement: Per-SiteGroup simulator publish rate SHALL be capped at 1,000 msg/s

A token-bucket rate limiter SHALL gate every NDATA publish in the simulator. Each SiteGroup gets its own bucket with capacity 1,000 and refill 1,000/s. When the bucket is empty, publishers SHALL delay (not drop) the next message.

The simulator SHALL expose a Prometheus counter `sim_rate_cap_delays_total{siteGroupId}` incremented each time a publish is delayed by the bucket being empty.

#### Scenario: Cap delays excess publishes

- **GIVEN** a SiteGroup with 100 Devices each at 100ms interval (aggregate target = 1,000 msg/s)
- **WHEN** an additional Device with 100ms interval is added (target now 1,010 msg/s)
- **THEN** the bucket SHALL empty within the first second
- **AND** subsequent publishes SHALL each delay until the bucket refills
- **AND** the `sim_rate_cap_delays_total{siteGroupId}` counter SHALL increment monotonically
- **AND** no messages SHALL be silently dropped

---

### Requirement: Dashboard widgets SHALL bind to { deviceKey, metric } and survive registration

The `WidgetBindingV2` shape SHALL be `{ deviceKey: string; metric: string }` and SHALL be the only binding format used by newly-created widgets. Existing widgets with legacy `{ siteId, topic }` bindings SHALL be migrated on `dashboard.load` by resolving the `clientId` segment of the topic via `Gateway.clientId` lookup to a `deviceKey`. Successful resolutions SHALL write `bindingV2` on the widget; the next `dashboard.save` SHALL persist it.

A registered device's `deviceKey` SHALL NOT change (see the `device_key` immutability requirement), so widgets MUST continue to render real-time data after spec 3 sets `realUuid`.

#### Scenario: Legacy widget migrates on dashboard.load

- **GIVEN** a Dashboard row containing a widget with `binding = { siteId: 's1', topic: 'modules/modules/NDATA/2C004A001351353230363438' }` and `bindingV2 = null`
- **AND** a Gateway row with `clientId = '2C004A001351353230363438'`, `deviceKey = 'ck0042'`
- **WHEN** `dashboard.load` is invoked
- **THEN** the returned widget SHALL include `bindingV2 = { deviceKey: 'ck0042', metric: <derived from topic> }`
- **AND** an `AuditLog` row SHALL be written with action `dashboard.binding-migrated`, metadata `{ widgetId, before: <legacy binding>, after: <new bindingV2> }`

#### Scenario: Widget binding survives registration

- **GIVEN** a widget with `bindingV2 = { deviceKey: 'ck0042', metric: 'temperature' }` rendering live data from a sensor
- **WHEN** spec 3's registration handshake assigns `realUuid` to the underlying Device row
- **THEN** the widget SHALL continue to render live data without re-binding
- **AND** the visual indicator on the widget (an "Unregistered" badge) SHALL clear on the next data tick

#### Scenario: Unresolvable legacy widget shows migration overlay

- **GIVEN** a widget with `binding = { siteId: 's1', topic: 'modules/modules/NDATA/UNKNOWN' }` and no matching Gateway
- **WHEN** `dashboard.load` runs and resolution fails
- **THEN** the widget SHALL be returned with `bindingV2 = null`
- **AND** the client SHALL render a "Binding migration needed — click to fix" overlay
- **AND** clicking the overlay SHALL open the binding-picker dialog seeded with the failed legacy values

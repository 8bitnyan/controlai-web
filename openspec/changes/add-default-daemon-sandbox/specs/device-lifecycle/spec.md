# Device-Lifecycle (Deltas for Default Daemon Sandbox)

## ADDED Requirements

### Requirement: Canvas Visual State for Registration

Every device node on the canvas SHALL render with distinct visual styles based on its `registrationState`. Unregistered nodes (simulated, pre-hardware) are drawn with dashed borders and faded icons; registered nodes (real boards) have solid borders.

#### Scenario: Dashed border for unregistered nodes

- **WHEN** a node has `Device.registrationState = 'UNREGISTERED'`
- **THEN** the canvas component SHALL render it with a dashed border (CSS border-style: dashed)
- **AND** the node's icon SHALL appear faded/grayed out (opacity 0.6 or similar)

#### Scenario: Solid border for registered nodes

- **WHEN** a node has `Device.registrationState = 'REGISTERED'`
- **THEN** the canvas component SHALL render it with a solid border
- **AND** the node's icon SHALL appear at full opacity

#### Scenario: Transition on successful registration

- **WHEN** a device's registration handshake completes (spec 3) and `registrationState` transitions from `REGISTERING` → `REGISTERED`
- **THEN** the canvas node's visual appearance SHALL update in real-time (or on next render) from dashed to solid border

### Requirement: Mixed Real and Synthetic Canvas

A single canvas SHALL support a mix of registered (real hardware) and unregistered (simulated) device nodes on the same SiteGroup. There is no mode toggle; each node's state determines its behavior independently.

#### Scenario: Mixed real and synthetic on same canvas allowed

- **WHEN** a user's canvas contains 3 `core-generic-sensor-input` nodes with `registrationState='REGISTERED'` and 2 nodes with `registrationState='UNREGISTERED'`
- **THEN** the Apply operation SHALL succeed
- **AND** both real boards and synthetic generators run simultaneously
- **AND** the daemon shall receive signals from both sources on the same broker topic

#### Scenario: Synthetic emits only for unregistered

- **WHEN** `device.simulationDesired = true` on an `UNREGISTERED` node
- **THEN** the simulator SHALL emit synthetic signals for that node
- **AND** the daemon receives both real and synthetic data interleaved on the same MQTT topic (in production, the UI distinguishes via source metadata)

#### Scenario: Real board takes over on claim

- **WHEN** a node transitions from `UNREGISTERED` → `REGISTERED` via the registration handshake
- **THEN** the simulator SHALL stop emitting synthetic data for that node
- **AND** the real board's signals replace the synthetic stream

### Requirement: Per-Node Synthetic Signal Config

Unregistered nodes on the canvas SHALL have configurable synthetic signal parameters exposed in the node-config-dialog. These include interval and value range, as well as inherited broker and TSDB settings.

#### Scenario: intervalMs field in node config

- **WHEN** a user opens the node-config-dialog for an `UNREGISTERED` node
- **THEN** a text input field labeled "Signal Interval (ms)" SHALL appear with default value 1000
- **AND** the user can edit it to any value ≥ 100
- **AND** clicking Save calls `device.update({ deviceKey, patch: { config: { intervalMs: <value> } } })`

#### Scenario: valueMin and valueMax fields

- **WHEN** the node-config-dialog is open for an unregistered node with `deviceTypeId='core-generic-sensor-input'`
- **THEN** fields `valueMin` and `valueMax` SHALL appear with sensible defaults for that device type
- **AND** the synthetic generator uses these bounds when creating signal values
- **AND** validation rejects if `valueMin >= valueMax`

#### Scenario: Broker and retention inherited from site

- **WHEN** a node-config-dialog is open and the site is configured with `brokerKind='mosquitto'` and `retentionDays=7`
- **THEN** these values SHALL appear in the dialog as read-only (inherited from parent Site)
- **AND** changing them in the site-level config (via Apply) affects all nodes in that site

### Requirement: Inline Per-Node Telemetry Sparkline

Each device node on the canvas SHALL display a small inline sparkline showing the last 30 seconds of signal telemetry. The sparkline updates in real-time as new telemetry arrives via SSE.

#### Scenario: Sparkline renders on telemetry tick

- **WHEN** a signal value arrives from the daemon (or simulator) and is stored in the canvas store
- **THEN** the sparkline component SHALL render a small line chart (e.g. 60px wide × 30px tall) showing the most recent ~30 points
- **AND** the line SHALL update smoothly with each new data point

#### Scenario: No data placeholder

- **WHEN** a node has no telemetry data yet (e.g. node just added to canvas)
- **THEN** the sparkline SHALL show a placeholder: "—" or "No data"
- **AND** once data arrives, the sparkline renders normally

#### Scenario: Sparkline cleared on node removal

- **WHEN** a user deletes a node from the canvas
- **THEN** the sparkline's telemetry history is cleared from the store
- **AND** a new node dropped in the same location starts with empty telemetry

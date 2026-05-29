# Device-Type Registry (Deltas for Default Daemon Sandbox)

## ADDED Requirements

### Requirement: Vendor-Neutral Generic Sensor Board Manifests

Seven new device-type manifests SHALL be registered under `core/generic-*` in the registry, representing the canonical sensor board types used in the default daemon sandbox. Each manifest SHALL include both English and Korean display names, category, port topology, and default signal shape.

#### Scenario: All seven manifests load at registry init

- **WHEN** the application initializes and imports `packages/shared-types/src/device-types/index.ts`
- **THEN** the registry SHALL contain exactly seven new entries with ids: `'core-generic-main-gateway'`, `'core-generic-sensor-input'`, `'core-generic-tilt-linear'`, `'core-generic-vibration-tilt-standalone'`, `'core-generic-control-485x2'`, `'core-generic-vibrating-wire-sensor'`, `'core-generic-noise-meter'`
- **AND** `listDeviceTypes()` SHALL return all seven

#### Scenario: Korean and English names render

- **WHEN** `getDeviceType('core-generic-main-gateway')` is called
- **THEN** the returned manifest's `displayName` field SHALL contain both Korean (e.g. `메인보드`) and English (e.g. `Main Gateway Board`) text
- **AND** the canvas palette SHALL render the Korean name to users (Korean-locale browsers)

#### Scenario: Port topology and signal defaults valid

- **WHEN** `DeviceTypeSchema.parse()` is called on each of the seven new manifests
- **THEN** all SHALL pass validation
- **AND** `core-generic-sensor-*` manifests SHALL have `defaultSignal` with `rateMs` in the range 100–1000 ms
- **AND** `core-generic-tilt-linear` SHALL have a config field `chainLength` with default 4

### Requirement: Attached Child Device Type (Noise Meter)

The `core-generic-noise-meter` device-type SHALL be an attached child that can only exist as a direct child of `core-generic-sensor-input`. It cannot be dropped as a standalone root node on the canvas.

#### Scenario: Noise meter can only parent under sensor-input

- **WHEN** connection validation checks a hypothetical edge from `core-generic-noise-meter` to `core-generic-main-gateway`
- **THEN** `validateConnection()` SHALL return `{ ok: false, code: 'INCOMPATIBLE_PARENT', reason: '...' }`

#### Scenario: Standalone noise-meter node rejected

- **WHEN** a user attempts to drop a `core-generic-noise-meter` node directly onto the canvas (without a parent)
- **THEN** the canvas SHALL reject the action with a message: "Noise Meter is an attached child and must be connected to a Sensor Input board"

#### Scenario: Noise meter properly attached

- **WHEN** connection validation checks `core-generic-sensor-input` (parent) → `core-generic-noise-meter` (child)
- **THEN** `validateConnection()` SHALL return `{ ok: true }`
- **AND** the edge is allowed

### Requirement: Chainable Device Type (Tilt Linear)

The `core-generic-tilt-linear` device-type SHALL support chaining (multiple units wired in series). Each unit in a chain emits its own signal. The `chainLength` config field (1–16, default 4) determines how many physical boards are chained.

#### Scenario: chainLength defaults to 4

- **WHEN** a user drops a `core-generic-tilt-linear` node without explicit config
- **THEN** the node's `Device.config.chainLength` SHALL default to 4
- **AND** the synthetic generator SHALL emit 4 independent tilt signals per tick (one per board in chain)

#### Scenario: chainLength can be set 1–16

- **WHEN** a user edits the node config and sets `chainLength: 8`
- **THEN** `device.update` SHALL accept the value
- **AND** validation SHALL reject values <1 or >16 with `VALIDATION_FAILED`

#### Scenario: Chaining via self-parent connection

- **WHEN** `validateConnection` is called with both source and target as `core-generic-tilt-linear` nodes
- **THEN** the result SHALL be `{ ok: true }` (self-chaining allowed)
- **AND** the canvas SHALL permit an edge from tilt-linear node A to tilt-linear node B

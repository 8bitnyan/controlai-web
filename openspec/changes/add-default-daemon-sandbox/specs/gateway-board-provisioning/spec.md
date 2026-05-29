# Gateway Board Provisioning (Deltas for Default Daemon Sandbox)

## ADDED Requirements

### Requirement: Typed Signal Generators in Simulator

The `apps/simulator` application SHALL provide five typed signal generator classes, each producing realistic synthetic telemetry matching the physics of its corresponding sensor board. Generators are selected by the `SensorConfig.pattern` discriminator.

#### Scenario: Tilt generator emits bounded degrees with drift

- **WHEN** a `TiltGenerator` is instantiated with `config={ interval: 1000, valueMin: -90, valueMax: 90, driftRate: 0.5 }`
- **AND** `next()` is called repeatedly
- **THEN** each value SHALL be within ±90 degrees
- **AND** values SHALL exhibit slow random-walk behavior (drift) simulating mechanical settling

#### Scenario: Vibration generator emits sinusoidal acceleration

- **WHEN** a `VibrationGenerator` is instantiated with `config={ interval: 100, amplitude: 2.5 }` (units: g)
- **AND** `next()` is called repeatedly
- **THEN** values SHALL oscillate around 0g with peak amplitude ≤ 2.5g
- **AND** the waveform SHALL approximate sinusoidal behavior at the given interval

#### Scenario: Crack-encoder generator emits sparse bursts

- **WHEN** a `CrackEncoderGenerator` is instantiated with `config={ interval: 5000, burstProbability: 0.1 }`
- **AND** `next()` is called repeatedly
- **THEN** most ticks return a null/no-event value
- **AND** roughly 10% of ticks emit an event (Poisson-distributed) representing encoder position or crack detection

#### Scenario: Noise-meter generator emits dBA envelope

- **WHEN** a `NoiseMeterGenerator` is instantiated with `config={ interval: 1000 }`
- **AND** `next()` is called repeatedly
- **THEN** values SHALL be in range 30–90 dBA (decibels A-weighted)
- **AND** the signal SHALL exhibit realistic envelope behavior (quiet periods interspersed with louder transients)

#### Scenario: Vibrating-wire generator emits resonance frequency

- **WHEN** a `VibratingWireGenerator` is instantiated with `config={ interval: 500 }`
- **AND** `next()` is called repeatedly
- **THEN** values SHALL represent resonance frequency in range 0–300 Hz
- **AND** the signal SHALL include damping ratio (0–1) reflecting environmental changes

### Requirement: Extended SensorConfig Pattern Discriminator

The `SensorConfig` TypeScript interface and Zod schema SHALL include a `pattern` discriminator field that selects which generator type to instantiate. Each pattern has its own set of parameters.

#### Scenario: Pattern field parses correctly

- **WHEN** `SensorConfig` is validated with `{ pattern: 'tilt', driftRate: 0.5, intervalMs: 1000 }`
- **THEN** the Zod schema SHALL parse successfully
- **AND** `pattern` is narrowed to the literal `'tilt'`
- **AND** pattern-specific fields like `driftRate` are accepted

#### Scenario: Unknown pattern is rejected

- **WHEN** `SensorConfig` is validated with `{ pattern: 'unknown-foo' }`
- **THEN** Zod validation SHALL throw `ZodError`
- **AND** the error message SHALL reference the allowed patterns: `'tilt', 'vibration', 'crack-encoder', 'noise-meter', 'vibrating-wire', 'random-walk'`

#### Scenario: random-walk pattern preserved for backward compatibility

- **WHEN** `SensorConfig` is validated with `{ pattern: 'random-walk', min: 0, max: 100 }`
- **THEN** the validation SHALL succeed
- **AND** the simulator SHALL use the existing `SignalGenerator` (bounded Gaussian random walk) for this pattern

### Requirement: Reuse Per-Gateway mTLS Cert Provisioning for Synthetic Gateways

Synthetic-kind gateways (emulated on behalf of the simulator) SHALL obtain their MQTT client certificates via the existing `gateway.issueFromDaemon` tRPC flow. No new authentication code is introduced.

#### Scenario: Synthetic gateway obtains mTLS cert

- **WHEN** an apply operation creates a simulated gateway (via canvas Apply with `Gateway.kind='simulator'`)
- **THEN** the apply flow calls `gateway.issueFromDaemon({ gatewayId, siteId })`
- **AND** the daemon's PKI endpoint returns `{ cert_pem, key_pem, fingerprint }`
- **AND** the cert is stored encrypted in `Gateway.clientCertPemEnc` as usual

#### Scenario: mTLS client cert stored and reused

- **WHEN** the simulator needs to authenticate to the daemon's broker
- **THEN** it reads the gateway's `clientCertPemEnc`, decrypts it
- **AND** uses the cert + key to establish a TLS connection to the broker
- **AND** the daemon receives a mutually-authenticated mTLS connection

#### Scenario: Synthetic MQTT publish succeeds

- **WHEN** the simulator publishes synthetic signal data to `tenants/{tenantId}/devices/{deviceId}/telemetry`
- **AND** the broker is configured with mTLS enforcement
- **THEN** the publish succeeds (the gateway's cert is valid and authorized)

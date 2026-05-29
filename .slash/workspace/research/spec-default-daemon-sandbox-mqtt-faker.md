# Research: Server-Side MQTT Signal Generators / IoT Data Simulators

**Date**: 2026-05-29T12:00:00Z  
**Requestor**: spec for `default-daemon-sandbox-mqtt-faker`  
**Context**: Next.js monorepo (`controlai-web`) with existing `simulator` app, `mqtt-bridge`, and mTLS-based gateway architecture. The project already has a `SignalGenerator` (random-walk) and `TokenBucket` rate limiter. This research covers enrichment for five sensor families.

---

## Summary

There is **no off-the-shelf npm package** that generates realistic multi-sensor IoT time series for the five specific sensor families needed (tilt, vibration, crack-encoder, noise-meter, vibrating-wire). The existing `@controlai-web/simulator` app already has the right architecture: a standalone Node.js process (Hono HTTP + MQTT.js client) that manages per-gateway mTLS connections and per-sensor publish loops. The gap is in **signal-shape realism** — the current `SignalGenerator` only does bounded Gaussian random-walk. The recommended path is to extend it with typed sensor pattern functions (no new dependencies), keep the standalone simulator process (don't embed in Next.js), and continue with mTLS auth (already implemented). The "direct HTTP" path is a viable alternative for specific testing scenarios but should supplement, not replace, MQTT.

---

## 1. Established Node.js MQTT Libraries

### `mqtt` (MQTT.js) ⭐ RECOMMENDED
- **npm**: `mqtt` v5.15.1 (released 2026-03-24)
- **Downloads**: ~3,500+ dependents on npm
- **License**: MIT
- **Status**: Mature, actively maintained (9.1k ★, last release <2 months old)
- **Features**: Full MQTT 3.1.1 + experimental 5.0 support, TLS/mTLS, WebSocket, QoS 0/1/2, TypeScript-native since v5, reconnection, LWT
- **Our project**: Already used in both `@controlai-web/simulator` (`manager.ts:2`) and `@controlai-web/mqtt-bridge`

**Key capability**: mTLS with custom `checkServerIdentity` — already implemented in `manager.ts:156-158` for per-gateway cert validation. The `mqtt.connect()` call forwards unknown TLS options to `tls.connect`, so cert/key/ca fields work directly with PEM strings (decrypted via `decryptToken`).

### `async-mqtt`
- Thin promise wrapper over MQTT.js; mostly obsoleted by MQTT.js's own promise support since v5. `mqtt.Client.publish` already returns a promise when no callback is given. Not recommended for new work.

### `aedes`
- **This is an MQTT broker**, not a client. Used when you need an in-process broker for testing. May be useful for the sandbox daemon if you want a zero-dependency local broker, but not for signal generation itself.
- Per-circle use: if the sandbox needs to run without an external broker, Aedes could run inside the simulator app. But the spec calls for publishing to a remote broker, so Aedes is out of scope for the faker itself.

---

## 2. IoT Data Faking Libraries / Patterns

### No targeted "MQTT faker" exists on npm
- **`mqtt-faker`** — no published npm package exists under this name. Several blog posts about "MQTT + faker.js" patterns exist, but no standalone library.
- **`iotsim`** — Python project, not Node.js. Uses NiceGUI for UI.
- **`pysor`** — Python-only MQTT sensor simulator. Pre-built temperature/humidity/light/water level/pH sensors.
- **IoT-data-simulator** (IBA-Group-IT) — Java + JS, last release 2018. Stale.

### Sparkplug-B ecosystem (NOT recommended for this use case)
- **Eclipse Tahu** — reference implementation in Java, C, Python, JS. The JS version is minimal and unmaintained.
- **Sparkplug-B** mandates Protobuf payloads (`sparkplug_payload.proto`), a rigid topic namespace (`spBv1.0/<group>/<message-type>/<node>/<device>`), and birth/death certificates. Our project already uses a custom CBOR-based protocol (`cbor-modules-cloud` mode in `manager.ts`) which is simpler and more flexible. Adopting Sparkplug-B would mean either switching to Protobuf (breaking change) or maintaining dual protocol support. **Recommendation: do not adopt Sparkplug-B for the faker.** The existing `encodeNbirth`/`encodeNdata`/`encodeNdeath` CBOR codec is sufficient.

### `@faker-js/faker` (v10 stable)
- Excellent for metadata generation (device IDs, locations, labels, timestamps), but does **not** generate realistic time-series signal shapes. Its `number` module produces uniform/independent random values, not the autocorrelated, drift-laden, bursty patterns that real sensors exhibit. **Use for test fixture data, not for signal values.**

### General pattern: build your own signal generators
This is the standard industry practice. Realistic IoT simulators (Bevywise, MIMIC, SimpleIoT) all define signal behavior per device type using configurable curves, random walks, and scheduled events. The right approach is a small library of composable signal functions — exactly what the existing `SignalGenerator` class can grow into.

---

## 3. Realistic Signal Shapes for Targeted Sensor Families

### 3a. Tilt / Inclinometer
**Physical behavior**: Measures angle from vertical (±X° range). Real signals show:
- **Slow thermal drift** (0.01–0.1°/hr due to diurnal temperature cycling)
- **Occasional shock events** (sudden 0.5–2° step when structure is struck, followed by exponential settling)
- **Long-term creep** (fractional degree over months)
- **White noise floor** (~0.001° RMS)

**Recommended model**:  
```
value(t) = baseline + sinusoidal_diurnal(t) + brownian_drift(t) + shock_events(t) + gaussian_noise(t)
```

Where `shock_events(t)` is a Poisson arrival process with amplitude sampled from exponential distribution, followed by `A * exp(-t/tau)` decay.

**Suggested signal config**:
```typescript
{ type: 'tilt', unit: 'deg', min: -15, max: 15, pattern: 'inclinometer',
  driftRate: 0.02,           // deg/hr thermal drift amplitude
  shockRate: 0.001,          // shocks per reading (rare)
  shockDecay: 30_000,        // 30s decay constant (ms)
  noiseFloor: 0.001 }        // ° RMS
```

**JSON payload shape**:
```json
{ "sensorId": "tilt-01", "ts": 1716000000000, "value": 0.423,
  "unit": "deg", "quality": 1, "temperature": 23.4 }
```

### 3b. Vibration (Accelerometer / Velocity)
**Physical behavior**: Measures acceleration (mm/s²) or velocity (mm/s) on rotating machinery. Real signals:
- **Sinusoidal at fundamental frequency** (e.g., 30 Hz motor RPM) with harmonics
- **Amplitude modulation** from load variation (envelope varies ±20% over seconds)
- **Impulsive bursts** from bearing defects (periodic impacts at characteristic frequencies)
- **Background noise** (1/f + white)

**Recommended model**:
```
value(t) = sum_n A_n(t) * sin(2*pi*n*f0*t + phi_n) + bearing_impulses(t) + noise(t)
```

Where `A_n(t)` is a slow random walk on the amplitude envelope, `f0` is the fundamental harmonic.

**Suggested signal config**:
```typescript
{ type: 'vibration', unit: 'mm/s', min: 0, max: 50, pattern: 'sinusoidal-walk',
  baseFreq: 30,              // Hz
  harmonicCount: 3,
  ampWalkRate: 0.5,          // mm/s per step envelope change
  bearingFreq: 0,            // 0 = healthy, >0 = BPFO/BPFI frequency
  noiseFloor: 0.1 }
```

**JSON payload shape**: (standard format from Siemens Senseye / Treon)
```json
{ "sensorId": "vib-01", "ts": 1716000000000, "value": 2.34,
  "unit": "mm/s", "quality": 1, "rms": 1.87, "peak": 4.12,
  "crestFactor": 2.2 }
```

If transmitting raw waveforms (streaming samples):
```json
{ "sensorId": "vib-01", "ts": 1716000000000,
  "amplitudeUnit": "mm/s", "spacing": 0.001, "number": 1024,
  "data": [0.1, 0.3, ...], "measurementType": "velocity" }
```

### 3c. Crack-Encoder (Vibrating Wire Crack Meter)
**Physical behavior**: Measures displacement across a crack/joint (±mm). Real signals:
- **Long-term monotonic drift** (crack opens 0.1–2 mm/year)
- **Seasonal cycling** (thermal expansion/contraction, ~0.1 mm amplitude)
- **Sparse burst events** (sudden 0.5–3 mm step during seismic/construction events)
- **Measurement noise** (~0.01 mm, readout-dependent per RST specs)

**Recommended model**:
```
value(t) = long_term_trend(t) + seasonal(t) + step_events(t) + noise(t)
```

Step events follow Poisson process, with each event being an instantaneous displacement (up or down) followed by stable plateau.

**Suggested signal config**:
```typescript
{ type: 'crack-encoder', unit: 'mm', min: 0, max: 50, pattern: 'vibrating-wire-crack',
  creepRate: 0.0002,         // mm/hr long-term drift
  seasonalAmplitude: 0.05,   // mm daily thermal cycle
  stepRate: 0.0005,          // step events per reading
  stepSizeMin: 0.1,          // mm min step
  stepSizeMax: 3.0,          // mm max step
  noiseFloor: 0.005 }
```

**JSON payload shape**:
```json
{ "sensorId": "crack-01", "ts": 1716000000000, "value": 12.347,
  "unit": "mm", "quality": 1, "temperature": 22.1,
  "frequency": 2456.3 }
```

The `frequency` field is the raw VW readout (Hz). Strain/displacement is derived via calibration factor `G * (f0² - f²)`. The faker could emit either raw frequency (more realistic) or directly the engineering value.

### 3d. Vibrating-Wire Piezometer (Pore Pressure)
**Physical behavior**: Measures pore water pressure (kPa). The VW transducer converts pressure to wire tension → resonant frequency. Key signal features:
- **Slow pressure drift** due to water table changes (rainfall response, tidal)
- **Rapid response to events** (minutes-scale rise after rain, exponential decay)
- **Barometric pressure variation** (~±1 kPa diurnal)
- **Temperature cross-sensitivity** (~0.1% FS/°C)

**Recommended model**:
```
value(t) = base_pressure + barometric(t) + rain_response(t) + exponential_drainage(t) + noise(t)
```

Rain events arrive as Poisson process, with a fast-rise/slow-decay impulse response (t_rise ≈ 30 min, t_fall ≈ 6 hr).

**Suggested signal config**:
```typescript
{ type: 'vibrating-wire-piezo', unit: 'kPa', min: 0, max: 500, pattern: 'vw-piezometer',
  basePressure: 100,          // kPa
  barometricAmplitude: 1.0,   // kPa
  rainRate: 0.01,             // rain events per reading
  rainRiseMs: 1_800_000,      // 30 min rise
  rainFallMs: 21_600_000,     // 6 hour decay
  rainPressureStep: 15,       // kPa per rain event
  noiseFloor: 0.05 }
```

**JSON payload shape**:
```json
{ "sensorId": "piezo-01", "ts": 1716000000000, "value": 187.34,
  "unit": "kPa", "quality": 1, "temperature": 18.7,
  "frequency": 3120.5 }
```

### 3e. Noise Meter (dBA Sound Level)
**Physical behavior**: Measures A-weighted sound pressure level (dBA). Real signals:
- **Baseline ambient** (35–55 dBA depending on environment)
- **Slow envelope fluctuation** (random walk on the log scale)
- **Impulsive events** (machinery start, horn, impact) with fast attack (~100 ms) and slow decay (~2-3 s)
- **Occupancy patterns** (higher during work hours, lower at night)

**Recommended model**:
```
spl(t) = ambient + occupancy_pattern(t) + envelope_walk(t) + impulse_events(t)
dBA = 10 * log10(sum(10^(spl_i/10)))
```

What the simulator emits is the time-weighted SPL, not raw microphone samples. The value is in dBA with ±0.1 dB resolution.

**Suggested signal config**:
```typescript
{ type: 'noise-meter', unit: 'dBA', min: 20, max: 130, pattern: 'spl-envelope',
  ambientBase: 40,           // dBA
  envelopeWalkStep: 0.3,     // dBA per step
  impulseRate: 0.002,        // impulse events per reading
  impulsePeakMin: 70,        // dBA min impulse
  impulsePeakMax: 105,       // dBA max impulse
  impulseDecayMs: 3000 }     // 3 second decay
```

**JSON payload shape**:
```json
{ "sensorId": "noise-01", "ts": 1716000000000, "value": 52.7,
  "unit": "dBA", "quality": 1, "leq": 51.2, "peak": 87.3,
  "frequencyWeighting": "A", "timeWeighting": "F" }
```

---

## 4. Operationalizing in a Next.js App

### Current architecture (correct approach)
The monorepo already has the right separation:

```
apps/
  simulator/           ← standalone Node.js MQTT signal generator (Hono HTTP server)
  mqtt-bridge/         ← standalone MQTT-to-HTTP bridge
  web/                 ← Next.js (pages / app router)
```

**The simulator should remain a standalone process.** Rationale:

| Concern | Standalone Process | Embedded in Next.js |
|---------|-------------------|-------------------|
| Lifecycle | Independent of web server | Dies on `next dev` restart |
| Backpressure | Can throttle independently | Shares event loop with HTTP |
| mTLS certs | Persistent connections | Must reconnect on every deploy |
| Observability | Dedicated metrics | Mixed with web metrics |
| Reconnection | MQTT.js handles it | Must survive Next.js HMR |

### Where to host the generator
**Option A: `apps/simulator` (already exists — RECOMMENDED)**
- Runs as a separate process, listens on port 4001
- Already has Hono HTTP server for status/control API
- Already has boot reconciliation from Prisma
- Already has per-gateway mTLS MQTT connections
- Deployment: Fly.io / Railway / k8s sidecar

**Option B: Next.js `instrumentation.ts` `register()` hook (NOT recommended)**
- Next.js 16's `instrumentation.ts` runs once at server startup in Node.js runtime
- **Problems**: The hook is designed for observability setup (OpenTelemetry), not long-lived background processes. The Next.js server can cold-start and stop unpredictably during deployments. No lifecycle management for MQTT connections. Running a persistent MQTT publisher inside a web server process is an anti-pattern.
- **Exception**: Could be used for a *very* lightweight "start faking on dev" toggle in `npm run dev`. But not for production sandbox.

**Option C: API route handler**
- A `POST /api/simulator/start` route handler in Next.js could start a gateway in the simulator via HTTP (the simulator already exposes a management API). This is the right integration pattern: the web app is the *control plane*, the simulator is the *data plane*.

### Lifecycle: Start/Stop per Canvas-Node
The existing `manager.ts` `startGateway()`/`stopGateway()` already maps cleanly:
- **User clicks "Simulate" in the web UI** → Next.js route handler calls `POST http://simulator:4001/gateways/:id/start`
- **Simulator receives request** → loads gateway config from DB, decrypts certs, connects to MQTT broker with mTLS, starts per-sensor intervals
- **User clicks "Stop"** → `POST http://simulator:4001/gateways/:id/stop` → publishes NDEATH (CBOR mode), disconnects cleanly, deletes runtime state
- **Boot reconciliation** (`reconcileOnBoot()` in `boot-reconcile.ts`) restarts any gateway that has `desiredState = 'running'` when the simulator process starts

### Backpressure / Rate Control
Already implemented in `manager.ts:57-63` using `TokenBucket` from `@controlai-web/shared-types`:
- Per `siteGroupId` rate cap (default 1000 msg/s)
- Fills at the cap rate, `acquire()` blocks when empty
- A `sim_rate_cap_delays_total` counter tracks throttling events (Prometheus metric)
- The `reconnectPeriod: 5000` on the MQTT client prevents reconnection storms

To extend for high-frequency sensor types (vibration at 1 kHz):
- For sub-second intervals, batch multiple sensor readings into single MQTT publish
- Add a `Notify()` pattern (borrowed from Noria/Kafka): the per-sensor interval timer pushes to a shared `BatchBuffer`, which flushes every `maxBatchInterval` or at `maxBatchSize`
- Currently each sensor has its own `setInterval` — at scale (>100 sensors), consider a single master tick and iterate all sensors

### Observability
Already using `prom-client` (Prometheus):
- `sim_rate_cap_delays_total` — rate cap hits
- `EventEmitter` events: `gatewayStatus`, `gatewayOutbox` — these can feed a Prometheus gauge for connected gateway count, and a log stream for published values
- `pino` logger with structured JSON
- Missing: per-sensor publish latency histogram, MQTT broker round-trip time

---

## 5. Auth Flow for Sending to MQTT Broker

### The daemon's broker: mTLS with per-site ingestor client certs
The project already implements this in `manager.ts:160-181`:

```typescript
const client = mqtt.connect(connectUrl, {
  clientId: gw.clientId,
  ca: rootCaPem,           // CA that signed the broker cert
  cert: clientCertPem,     // Site-specific client certificate
  key: clientKeyPem,       // Client private key
  rejectUnauthorized: true,
  servername: servername,  // SNI hostname for cert validation
  checkServerIdentity: (host, cert) => checkServerIdentity(servername, cert)
});
```

**How the web-side generator authenticates as a "fake board":**

| Approach | Feasibility | Recommendation |
|----------|-------------|----------------|
| **Reuse same gateway credentials** | Already works | ✅ Each fake gateway has its own DB row with `rootCaPemEnc`, `clientCertPemEnc`, `clientKeyPemEnc`. The simulator decrypts these tokens and connects with the same mTLS flow as a real board. |
| **Shared dev/sandbox cert** | Possible but weak | A single sandbox client cert shared by all fake gateways. Won't work if the broker enforces per-client-id ACLs. |
| **Username/password** | Simpler but not implemented | The daemon broker uses mTLS exclusively. Switching to username/password for fake boards means either: (a) running a second listener on the broker, or (b) maintaining two auth paths in the ingest pipeline. |
| **JWT token in MQTT username field** | Not needed | mTLS already provides identity binding. JWT in MQTT CONNECT is fragile (packet size limits). |

**Recommendation**: Continue with the existing per-gateway mTLS approach. When provisioning a sandbox gateway:
1. Create a gateway record in the DB (same schema as real gateways)
2. Generate a client cert signed by the site-group CA
3. Store encrypted PEMs in `gateway.rootCaPemEnc` / `gateway.clientCertPemEnc` / `gateway.clientKeyPemEnc`
4. The simulator's existing `startGateway()` flow handles the rest

This means the "fake board" is indistinguishable from a real board from the broker's perspective — which is the whole point of the sandbox.

### TLS options recap for `mqtt.connect()`:

```typescript
interface MqttTLSOptions {
  ca: string | string[] | Buffer | Buffer[];       // CA certificate(s)
  cert: string | string[] | Buffer | Buffer[];     // Client certificate
  key: string | string[] | Buffer | Buffer[];      // Client private key
  rejectUnauthorized?: boolean;                     // Default: true
  servername?: string;                              // SNI extension
  checkServerIdentity?: (host: string, cert: PeerCertificate) => Error | undefined;
}
```

**Security consideration**: `rejectUnauthorized: false` MUST NOT be used in production. The existing code correctly defaults to `true`.

---

## 6. Alternative: Publish Directly to Ingest HTTP Endpoint

### Trade-off analysis

| Dimension | MQTT Path (current) | HTTP Direct |
|-----------|-------------------|-------------|
| **Protocol realism** | ✅ Indistinguishable from real board | ❌ Different code path, protocol, timing |
| **Latency** | ✅ Sub-millisecond pub (persistent TCP) | ❌ Connection setup per batch (if no keep-alive) |
| **Throughput** | ✅ MQTT is extremely efficient | ❌ HTTP headers add ~200B per message |
| **Broker validation** | ✅ Exercises the full pipeline | ❌ Skips broker, tests only ingest |
| **Backpressure** | MQTT QoS controls | Application-level rate limiting |
| **TLS overhead** | One handshake per connection | Per-request handshake (or keep-alive) |
| **Error semantics** | Pub/sub with QoS levels | HTTP status codes |
| **Firewall traversal** | May need 8883 open | ✅ Port 443 (standard HTTPS) |
| **Implementation cost** | Already done | New code path |
| **Debugging** | Harder (binary protocol, Wireshark needed) | ✅ Easy (curl, HTTP logs) |
| **Ordering guarantees** | Single TCP connection preserves order | H-like load balancers may reorder |

### When to use HTTP direct?
- **Quick smoke tests** during UI development (curl a sample to the ingest endpoint)
- **Offline/batch simulation** where MQTT auth setup is too heavy
- **One-shot data injection** for dashboard previews

### When to avoid HTTP direct?
- End-to-end pipeline validation (must include broker)
- Latency/throughput benchmarks
- Testing broker-side features (retained messages, LWT, QoS)
- Production sandbox — users need to trust the results

### Architecture for HTTP fallback
If you add this path, it should look like:

```typescript
// In apps/simulator or as a new module in packages/simulator-core
interface DirectIngestClient {
  postSample(sensorId: string, value: number, ts: number): Promise<Response>;
  postBatch(samples: Array<{ sensorId: string; value: number; ts: number }>): Promise<Response>;
}

// Implementation using fetch (available in Node 22+)
class HttpIngestClient implements DirectIngestClient {
  constructor(private baseUrl: string, private apiKey: string) {}

  async postSample(sensorId: string, value: number, ts: number): Promise<Response> {
    return fetch(`${this.baseUrl}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': this.apiKey },
      body: JSON.stringify({ sensorId, value, ts }),
    });
  }
}
```

---

## 7. Library Recommendations with Weights

### Core Libraries

| Library | Weight | Category | Why |
|---------|--------|----------|-----|
| **`mqtt`** (MQTT.js) | ⭐⭐⭐⭐⭐ | MQTT Client | Already in use, TypeScript-native, mTLS support, 3,500+ dependents, MIT license. v5.15.1 as of 2026-03 |
| **`@faker-js/faker`** | ⭐⭐⭐ | Metadata Gen | Useful for device IDs, locations, labels, timestamps. Not for signal values. Use only as `devDependency`. |
| **`prom-client`** | ⭐⭐⭐⭐ | Observability | Already in use. Adds Prometheus metrics for rate-limiting delays and gateway status. |
| **`pino`** | ⭐⭐⭐⭐ | Logging | Already in use. Structured JSON logging for debugging simulator behavior. |
| **`@controlai-web/shared-types`** (TokenBucket) | ⭐⭐⭐⭐⭐ | Rate Control | Already in use. Token bucket per site-group prevents broker flooding. |
| **`hono`** | ⭐⭐⭐⭐ | HTTP Framework | Already in use for the simulator control plane API. Lightweight, fast, TypeScript-native. |

### Recommended Architecture (NO new dependencies)

The signal generator extension should be **pure TypeScript** — no new npm dependencies needed. The signal models described in §3 are all mathematical functions that can be implemented using built-in `Math.*`:

```typescript
// Patterns to add to apps/simulator/src/signal-generator.ts

export class TiltSignalGenerator {
  // Brownian drift + diurnal cycle + shock events + noise
}

export class VibrationSignalGenerator {
  // Multi-harmonic sine + envelope walk + bearing impulses
}

export class CrackEncoderSignalGenerator {
  // Long-term creep + seasonal + step events
}

export class VWPiezoSignalGenerator {
  // Base pressure + barometric + rain response + drainage decay
}

export class NoiseMeterSignalGenerator {
  // Log-scale envelope walk + impulse events + occupancy pattern
}
```

### Libraries explicitly NOT recommended

| Library | Weight | Reason |
|---------|--------|--------|
| `async-mqtt` | ⛔ | Obsoleted by MQTT.js v5 native promises |
| `aedes` | ⛔ | Broker, not client. Only useful if sandbox needs local broker |
| `tahu` (Eclipse Sparkplug) | ⛔ | Protobuf dependency, unmaintained JS variant. Incompatible with existing CBOR codec |
| `sparkplug-payload` | ⛔ | Same reason; would require dual-protocol support or migration |
| `node-red` | ⛔ | Visual programming tool, not embeddable as a library |
| `simjs` / `simpy` patterns | ⚠️ | Discrete-event simulation libraries; overkill for continuous signal generation |

---

## Concrete Recommendations for the Spec

### Recommendation 1: Extend the existing `SignalGenerator` (no new deps)
Add 5 new generator classes in `apps/simulator/src/generators/` for tilt, vibration, crack-encoder, vibrating-wire-piezo, and noise-meter. Each implements a common `ISignalGenerator` interface. The dispatcher in `manager.ts` selects the generator class based on `sensor.pattern` or `sensor.deviceTypeId`.

**Cost**: ~300 lines of TypeScript  
**Risk**: None (pure math, existing pattern)  
**Impact**: Enables sandbox validation of the full pipeline with realistic data

### Recommendation 2: Keep the simulator as a standalone process
The existing architecture (separate `apps/simulator` process with Hono HTTP control plane) is correct. Do NOT embed MQTT publishers inside Next.js. Route handler API calls from the web app to the simulator for start/stop control.

### Recommendation 3: Continue with per-gateway mTLS
The existing mTLS cert flow is the right approach. When provisioning a sandbox gateway, generate a dedicated client cert and store encrypted PEMs. The fake board is indistinguishable from real hardware from the broker's perspective.

### Recommendation 4: Add HTTP direct ingest as an alternative output
For quick smoke tests and UI development, add an `HttpIngestClient` that POSTs samples to `/api/ingest` directly. This should be a `mode` toggle (`mqtt` vs `http`) on the sensor or gateway config, not a replacement for the MQTT path.

### Recommendation 5: Per-sensor config schema
The existing `SensorConfig` in `types.ts` needs a `pattern` discriminator and pattern-specific parameters. Extend the Zod schema accordingly:

```typescript
// Add to shared-types or simulator-local types
interface TiltConfig extends BaseSensorConfig {
  type: 'tilt';
  pattern: 'inclinometer';
  driftRate: number;       // °/hr
  shockRate: number;       // Probability per reading
  shockDecay: number;      // ms
}

interface VibrationConfig extends BaseSensorConfig {
  type: 'vibration';
  pattern: 'sinusoidal-walk';
  baseFreq: number;        // Hz
  harmonicCount: number;
  ampWalkRate: number;
}
```

This allows the device-type registry (`@controlai-web/shared-types/src/device-types/`) to define `defaultSignal` with typed defaults per sensor family, and the UI to surface the right controls based on `deviceTypeId`.

---

## References

- **MQTT.js v5 documentation**: https://github.com/mqttjs/MQTT.js (9.1k ★)
- **EMQX MQTT with Node.js guide (2025)**: https://www.emqx.com/en/blog/how-to-use-mqtt-in-nodejs
- **Next.js instrumentation hook**: https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
- **VW Piezometer operation**: https://www.geo-instruments.com/technology/piezometers
- **VW Crack Meter specs**: https://rstinstruments.com/product/crack-meter
- **Siemens Senseye vibration JSON format**: https://developer.siemens.com/senseye/machine/formats/vibration/waveforms/json.html
- **Treon Industrial Node JSON data description**: https://kb.treon.fi/pathmesh/indnode/sensorjson/
- **@faker-js/faker**: https://www.npmjs.com/package/@faker-js/faker (10.4.0)
- **Existing `@controlai-web/simulator`**: `apps/simulator/src/manager.ts`, `apps/simulator/src/signal-generator.ts`
- **Existing shared TokenBucket**: `packages/shared-types/src/token-bucket.ts`

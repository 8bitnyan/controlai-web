# Change: Add multi-broker driver registry, multi-ingest paths, TSDB writer, and topic-schema migration

## Why

After specs 1-3 land, the platform models device types as plugin manifests, materializes every canvas node as a stable `Device` row with an immutable `device_key`, and can rewrite shadow → real UUIDs on registration without touching `device_key`. But the **runtime** is still single-shape:

1. **`mqtt-bridge` hardcodes one transport** — `mqtt.js` + port `8883` + the legacy `modules/{groupId}/{msgType}/{clientId}` topic schema. Adding a second broker kind, a second ingest protocol (Kafka, HTTP webhook), or a second-codec board (anything non-DAEJAK) requires editing `mqtt-manager.ts` directly.
2. **`mqtt-bridge` does not write to TSDB.** It buffers Redis Streams + SSE. The `TimescaleDB` node in the canvas exists, the apply-planner emits an `updateTsdb` op, the daemon stores retention config — but nothing persistently writes time-series rows to TSDB. Dashboards survive on Redis snapshots only.
3. **Topics use mutable identifiers.** `groupId` and the board's `clientId` (which equals `realUuid`) are baked into MQTT topic paths AND embedded in CBOR `NBIRTH` payload buffers. This violates the cross-spec invariant `device_key` is the operational key. Spec 3's UUID swap stamps `realUuid` on the Device row, but the broker still routes traffic under the legacy topic that contains the same `realUuid` — meaning any future change to `realUuid` (board hardware swap) breaks routing.
4. **Apply-planner assumes one broker per Site, one MQTT path everywhere.** True multi-site / multi-protocol operation requires the planner and the runtime to dispatch on driver type.

The user explicitly chose: full `BrokerDriver` registry refactor (mirroring the device-type registry pattern from spec 1); add four drivers in v1 (`mqtt-driver`, `kafka-driver`, `http-webhook-driver`, `tsdb-direct-driver`); spin up a new `apps/tsdb-writer` service; introduce `controlai/{siteId}/{deviceKey}/{dataType}` topic schema with a dual-publish/dual-subscribe migration window of one minor release; keep the legacy `modules/...` topic alive at the mqtt-bridge ingress (board firmware is fixed and cannot be reconfigured to the new topic schema).

The board firmware constraint is structurally important: **the boards keep publishing on `modules/...`** indefinitely. mqtt-bridge becomes the translation layer that resolves each legacy topic's `clientId` → `device_key` via the existing alias (Gateway.clientId → Gateway.deviceKey → Device row). After translation, every downstream component (Redis Streams, SSE fanout, tsdb-writer, dashboards) operates on the new `{deviceKey, dataType}` shape.

## What Changes

This change introduces a new capability **`runtime-driver-registry`** that:

- Refactors `apps/mqtt-bridge` into a thin orchestrator over a `BrokerDriver` registry (the registry mirrors spec 1's pattern: in-repo TS module per driver, validated by a shared Zod `BrokerDriverSchema`).
- Adds `apps/tsdb-writer` — a new standalone Node service consuming Redis Streams and writing into a TimescaleDB `sensor_data` hypertable partitioned by `(siteId, deviceKey)`.
- Translates legacy `modules/...` topics into the new `{ deviceKey, dataType }` normalized message shape at mqtt-bridge ingress. The new `controlai/{siteId}/{deviceKey}/{dataType}` topic schema is used for outbound publishes (simulator + future non-DAEJAK devices).
- Stores per-Site `driverConfig` (JSONB) on the Site row, selected and validated by the chosen driver.
- Migrates apply-planner to dispatch on `manifest.category` + `Site.driverConfig.driverId`.
- Migrates Dashboard widgets' SSE consumption to the new normalized shape (no UI changes; the SSE event payload now has `{ deviceKey, dataType, payload, ts }` instead of `{ topic, payload, ts }`).

This change is the LAST in the sequence and depends on the prior three.

### New capability spec `runtime-driver-registry`

- **NEW PACKAGE** `packages/runtime-drivers/`:
  - `schema.ts` — exports `BrokerDriverSchema` (Zod), `IngestDriverSchema`, `NormalizedMessageSchema`, types.
  - `registry.ts` — exports `registerBrokerDriver`, `getBrokerDriver(id)`, `listBrokerDrivers()`. Mirrors the device-type registry pattern.
  - `normalized-message.ts` — exports `NormalizedMessage = { deviceKey, dataType: 'birth'|'data'|'death'|'cmd', payload: unknown, ts: ISO8601, sourceTopic?: string, sourceDriver: string }`. This is the wire format on Redis Streams, SSE, and tsdb-writer input.
  - `topic-translator.ts` — exports `translateLegacyTopic(topic, payload): NormalizedMessage | null` resolving `modules/{groupId}/{NBIRTH|NDATA|NDEATH}/{clientId}` → `{ deviceKey, dataType }` via Prisma's `Gateway.clientId → deviceKey` lookup (cached in-memory). Also exports `formatNewTopic({ siteId, deviceKey, dataType }): string` returning `controlai/{siteId}/{deviceKey}/{dataType}`.
  - `drivers/index.ts` — side-effect imports for all v1 drivers below.

- **NEW BROKER DRIVERS** under `packages/runtime-drivers/drivers/`:
  - `mqtt-driver/` — wraps `mqtt.js`. Connects, subscribes to BOTH `modules/#` (legacy) AND `controlai/{siteId}/#` (new). Decodes CBOR for legacy `modules/` topics; passes JSON / Sparkplug for new topics. Emits `NormalizedMessage` to a shared bus.
  - `kafka-driver/` — wraps `kafkajs`. Consumes from configured topics. Decoder is JSON only in v1.
  - `http-webhook-driver/` — exposes a per-Site HTTP endpoint `POST /ingest/{siteId}` (HMAC-authenticated header `X-Controlai-Signature`). Accepts JSON, parses to `NormalizedMessage` via a per-driver mapper config.
  - `tsdb-direct-driver/` — *not a transport-receive driver*; consumed by `apps/mqtt-bridge` when a Site's config opts into bypassing Redis and writing directly to TSDB. Configures the tsdb-writer client to ALSO be invoked synchronously inside mqtt-bridge.

- **NEW SERVICE** `apps/tsdb-writer/`:
  - `src/index.ts` — HTTP server on `TSDB_WRITER_PORT` (default 4002) for health + metrics.
  - `src/consumer.ts` — XREADGROUP-style consumer over Redis Streams, partitioned by `siteId` consumer group. Inserts into TimescaleDB `sensor_data` hypertable. Idempotent via `(siteId, deviceKey, ts, dataType)` natural key + ON CONFLICT DO NOTHING.
  - `src/schema.sql` — `sensor_data` hypertable DDL + continuous aggregate templates (1m / 1h / 1d rollups, controlled by Site.retentionPeriod).
  - `src/migrations/` — TimescaleDB migrations managed by `node-pg-migrate` (NEW devDep) keyed by schema version.
  - Performance target: ≥ 50,000 msg/s sustained per writer instance; horizontal scaling via consumer-group sharding.

- **NEW PRISMA MODEL FIELDS** on `Site`:
  - `driverId String?` — FK-ish (string id of a registered BrokerDriver). Defaults to `'mqtt-driver'` for migrated sites.
  - `driverConfig Json?` — driver-specific config, validated by the chosen driver's Zod schema.
  - `ingestModeJson Json?` — controls `redisAndSse` (default) vs `redisAndSseAndTsdbDirect` vs `tsdbOnly`.

- **NEW PRISMA MIGRATION** `add-site-driver-config`.

- **MODIFIED APPS/MQTT-BRIDGE** — refactor into orchestrator:
  - `src/orchestrator.ts` — replaces `src/mqtt-manager.ts`. Loads each managed Site, resolves its `driverId` via the registry, instantiates the driver, wires its output bus into Redis-writer + SSE-fanout + (optionally) tsdb-writer-direct.
  - `src/ingress-translator.ts` — wraps each driver's emitted message stream and routes through `translateLegacyTopic` for legacy `modules/` topics. New-schema topics pass straight through.
  - `src/redis-writer.ts` (existing) — changes its key format from `{siteId}:{topic}` to `{siteId}:{deviceKey}:{dataType}`. Migration: writes BOTH key formats during the dual-stack window (one minor release). After the window, the legacy key format is removed.
  - `src/sse-fanout.ts` (existing) — emits `NormalizedMessage` (was `{ topic, payload, ts }`). SSE event `data:` field shape changes. Backward compat: emit BOTH shapes in the dual-stack window.

- **MODIFIED `apps/simulator`** — uses the new `controlai/{siteId}/{deviceKey}/{dataType}` topic for outbound publishes when the Site's `driverId === 'mqtt-driver'`. Sparkplug / CBOR codec for sensor groups stays as today (board firmware is fixed; simulator mirrors its on-wire format for parity). The simulator's outbound topics are NOT seen by the board; they only feed mqtt-bridge.

- **MODIFIED `apps/web` Dashboard widgets** — consume the SSE stream's new payload shape; in the dual-stack window each widget normalizes both old and new shapes via a tiny adapter. By the end of the dual-stack window, only the new shape is in use.

- **MODIFIED `apply-planner.ts`** — `synthesizePlan` now emits a `configureDriver({ siteId, driverId, driverConfig })` op per broker node, plus a `migrateTopicSchema({ siteGroupId, mode: 'dual' | 'new-only' })` op when the user explicitly opts a SiteGroup into the new schema (or when the deploy-time flag flips global).

- **NEW APPLY OPS** (added to `packages/shared-types/src/apply.ts`):
  - `configureDriver` — { siteId, driverId, driverConfig }; idempotent; runs via Site.update + driver.validateConfig.
  - `migrateTopicSchema` — { siteGroupId, mode: 'dual' | 'new-only' }; sets a per-SiteGroup flag on a new `SiteGroup.topicSchemaMode` column. The mqtt-bridge orchestrator honors this flag when subscribing + publishing.

- **NEW PRISMA MODEL FIELD** on `SiteGroup`: `topicSchemaMode String @default('legacy')` — enum `legacy | dual | new`.

- **NEW DASHBOARD MIGRATION**: in tandem with the dual-stack window, widgets with `bindingV2` (set in spec 2) start consuming from the new normalized SSE shape. No further user-side action needed; the binding shape `{ deviceKey, metric }` is already the right key.

- **DEPRECATED IN ONE MINOR RELEASE** (NOT removed in this change, marked-only):
  - Redis key prefix `{siteId}:{topic}` (legacy form).
  - SSE event payload with `{ topic, ts, payload }` shape.
  - `mqtt-bridge` direct CBOR decode (moves into `mqtt-driver`).
  - `mqtt-bridge`'s hardcoded port `8883` (driver config now carries it).

### Cross-spec invariant enforcement

This change is the final enforcement step for the invariant **`device_key` is immutable from drop to delete**. Once the topic translator + tsdb-writer are in place, every downstream component routes traffic by `device_key`. A future board hardware swap mutates `realUuid` on the Device row (spec 3's re-register flow) but routing continues to work because the topic translator resolves `clientId → deviceKey` via the alias table, NOT the legacy `realUuid`.

### Tests

- Unit (`packages/runtime-drivers`):
  - `schema.spec.ts`, `registry.spec.ts`.
  - `topic-translator.spec.ts` — both legacy → normalized and new-format inverse.
  - Each driver: `mqtt-driver.spec.ts`, `kafka-driver.spec.ts`, `http-webhook-driver.spec.ts`, `tsdb-direct-driver.spec.ts`. Each driver runs a shared `driver-conformance-suite.ts` (~12 cases) verifying the same minimal contract: `connect / subscribe / publish / healthCheck / validateConfig`.
- Integration (`apps/mqtt-bridge`):
  - Embedded Mosquitto broker (already test infra from existing spec) → mqtt-driver → orchestrator → Redis + SSE; legacy and new topics both flow.
  - Driver-config validation rejects bad shape with a clear error.
- Integration (`apps/tsdb-writer`):
  - Testcontainers TimescaleDB image. Publishing 10k normalized messages over 5s lands them in `sensor_data` with idempotent inserts on retry.
  - Continuous aggregate refresh job updates the 1m rollup.
- E2E (Playwright):
  - SiteGroup with one daejak-main-v1 gateway, two daejak-vm sensors, registered. SiteGroup.topicSchemaMode='dual'. Simulator publishes on new schema; board would publish on legacy schema (mocked via mqtt-driver test fixture). Dashboard widget shows merged stream.
- Migration tests:
  - Flip `topicSchemaMode: legacy → dual → new-only`. Dashboards survive each transition.

## Impact

- **Affected specs**: depends on `add-plugin-device-type-registry`, `add-unregistered-device-lifecycle`, `extend-gateway-register-handshake`. NEW capability `runtime-driver-registry`.
- **Affected code**:
  - `packages/runtime-drivers/` — NEW package.
  - `apps/mqtt-bridge/src/` — full orchestrator refactor; `mqtt-manager.ts` becomes the mqtt-driver.
  - `apps/tsdb-writer/` — NEW service.
  - `apps/simulator/src/manager.ts` — outbound topic format switch per Site's `driverId`.
  - `packages/db/prisma/schema.prisma` — Site fields + SiteGroup field + new sensor_data hypertable migration.
  - `packages/api/src/lib/apply-planner.ts` — emits two new op types.
  - `packages/api/src/routers/apply.ts` — handles the new op types.
  - `apps/web/components/dashboard/widgets/*` — small adapter for the dual-stack SSE payload shape.
- **Affected user UX**:
  - Sites table gains "Driver: mqtt-driver" column; click reveals driverConfig in an existing Card.
  - SiteGroup canvas gains a small "Topic schema: legacy / dual / new" pill in the toolbar (read-only display; toggled by ops-only Apply ops or env flag).
  - Dashboards keep working transparently across the migration window.
- **Non-goals**:
  - Producer (outbound) Kafka path — consumer only in v1.
  - OPC-UA pull driver.
  - Plugin manifest distribution outside the in-repo `packages/runtime-drivers/drivers/` tree.
  - Cross-broker bridging (sending a message that arrived on Kafka onward to MQTT).
- **Risk surface**:
  - The legacy → new topic translation hot path adds a Prisma lookup; the in-memory cache MUST handle staleness on Gateway.clientId edits (rare). Cache TTL 5 minutes; explicit invalidation on Gateway.update.
  - The tsdb-writer is a new piece of production infra. Mis-tuned consumer group rebalancing under load could lose messages — testcontainers integration test covers retry semantics.
  - `topicSchemaMode` flag interacts with EVERY downstream consumer; mid-rollout a single forgotten consumer means a SiteGroup goes dark. Migration checklist enumerates each consumer explicitly.

# runtime-driver-registry Specification (delta)

## ADDED Requirements

### Requirement: BrokerDriver registry SHALL be a single Zod-validated, in-repo, side-effect-imported catalog

The package `@controlai-web/runtime-drivers` SHALL export `BrokerDriverSchema` (Zod) and a registry API (`registerBrokerDriver`, `getBrokerDriver`, `listBrokerDrivers`) following the same in-repo, import-time-populated pattern as the device-type registry. Each driver lives in `packages/runtime-drivers/drivers/<id>/index.ts` and calls `registerBrokerDriver({...})` at module load. The aggregator `drivers/index.ts` SHALL contain one side-effect import per driver folder.

#### Scenario: mqtt-driver registers on import

- **WHEN** `packages/runtime-drivers/src/drivers/index.ts` is imported (via the package's main entry)
- **THEN** `getBrokerDriver('mqtt-driver')` SHALL return a registered driver with `id: 'mqtt-driver'`
- **AND** `listBrokerDrivers()` SHALL include it

#### Scenario: Duplicate driver id is rejected loudly

- **WHEN** two modules call `registerBrokerDriver({ id: 'mqtt-driver', ... })`
- **THEN** the second call SHALL throw `Error` whose message contains `Duplicate broker-driver id: mqtt-driver` and a hint referencing the first call site
- **AND** package initialization SHALL fail at import time

#### Scenario: Driver missing required schema field rejected

- **WHEN** a driver registers with an object lacking `configSchema`
- **THEN** `BrokerDriverSchema.parse` SHALL throw `ZodError` whose `.issues[0].path` references `['configSchema']`
- **AND** the driver SHALL NOT be added to the registry

---

### Requirement: Every BrokerDriver SHALL implement the minimal interface — connect, subscribe, publish, healthCheck, validateConfig

A `BrokerDriverInstance` SHALL expose:

- `connect(): Promise<void>` — opens the underlying transport.
- `subscribe(topicPattern, qos, handler): Promise<void>` — registers a handler invoked with a `NormalizedMessage` per inbound payload.
- `publish(topic, payload, opts?): Promise<void>` — best-effort publish; throws if the driver does not support outbound (e.g. http-webhook-driver, kafka-driver in v1).
- `healthCheck(): Promise<{ status: 'ok'|'degraded'|'down'; lastError?: string }>`.
- `validateConfig(cfg): { ok: true; cfg } | { ok: false; reason }`.
- `close(): Promise<void>` — graceful shutdown.

All BrokerDriver instances SHALL pass the shared driver-conformance test suite (`packages/runtime-drivers/src/__tests__/driver-conformance-suite.ts`).

#### Scenario: kafka-driver throws on publish in v1

- **WHEN** a kafka-driver instance receives `instance.publish(topic, payload)`
- **THEN** the call SHALL throw `Error('kafka-driver does not support publish in v1')`
- **AND** no Kafka producer SHALL be initialized

#### Scenario: Conformance suite passes for all v1 drivers

- **WHEN** the conformance suite runs against `mqtt-driver`, `kafka-driver`, `http-webhook-driver`, `tsdb-direct-driver`
- **THEN** every test case SHALL pass
- **AND** drivers that legitimately do not support a capability SHALL throw the documented sentinel error (asserted in the suite)

---

### Requirement: NormalizedMessage SHALL be the wire format on Redis Streams, SSE fanout, and tsdb-writer input

`NormalizedMessage` is the type `{ deviceKey: string (cuid); dataType: 'birth'|'data'|'death'|'cmd'; payload: unknown; ts: ISO8601; sourceTopic?: string; sourceDriver: string }`. Every component downstream of a driver SHALL produce or consume this shape. Redis Streams payloads SHALL be a single field whose value is the JSON-encoded NormalizedMessage. SSE events SHALL carry the same JSON on the `data:` field (and, in `dual` topicSchemaMode only, ALSO carry a legacy-shaped `event: legacy` event for backwards compatibility).

#### Scenario: Driver emits NormalizedMessage

- **GIVEN** an mqtt-driver instance subscribed to `modules/#`
- **WHEN** the broker delivers a CBOR NDATA on topic `modules/modules/NDATA/2C004A001351353230363438` whose Gateway row maps to deviceKey `ck0042`
- **THEN** the driver SHALL invoke the handler with a NormalizedMessage `{ deviceKey: 'ck0042', dataType: 'data', payload: <decoded CBOR>, ts: <ISO>, sourceTopic: 'modules/modules/NDATA/2C00...', sourceDriver: 'mqtt-driver' }`

#### Scenario: NormalizedMessage validates strictly

- **WHEN** an invalid NormalizedMessage is parsed (e.g. dataType not in the enum)
- **THEN** `NormalizedMessageSchema.parse` SHALL throw `ZodError`
- **AND** the consumer (tsdb-writer) SHALL skip the message and emit a structured warning log with the message id

---

### Requirement: Legacy `modules/...` topics SHALL be translated to NormalizedMessage at ingress

The function `translateLegacyTopic(topic, payload)` exported from `@controlai-web/runtime-drivers` SHALL accept inbound topic strings matching `/^modules\/[^/]+\/(NBIRTH|NDATA|NDEATH)\/([0-9A-F]{24})$/` and produce a `NormalizedMessage` by:

1. Decoding the `clientId` (group 2 of the regex).
2. Looking up `Gateway.clientId == clientId` to obtain `Gateway.deviceKey`. Lookups SHALL be cached in an LRU with capacity 10,000 and TTL 5 minutes.
3. Setting `dataType` from `NBIRTH → 'birth'`, `NDATA → 'data'`, `NDEATH → 'death'`.
4. Decoding the payload via CBOR when the payload is a `Buffer` whose first byte indicates CBOR; otherwise passing through.

Topics not matching the regex SHALL return `null` and the orchestrator SHALL log a structured warning naming the topic and the responsible driver.

#### Scenario: Legacy topic translates with cached deviceKey

- **GIVEN** an mqtt-driver-attached cache with `'2C004A001351353230363438' → 'ck0042'`
- **WHEN** `translateLegacyTopic('modules/modules/NDATA/2C004A001351353230363438', cborPayload)` is invoked
- **THEN** the result SHALL be a NormalizedMessage with `deviceKey: 'ck0042'`, `dataType: 'data'`, `sourceTopic` preserved
- **AND** no Prisma query SHALL be issued (cache hit)

#### Scenario: Cache miss triggers Prisma lookup

- **GIVEN** an empty cache
- **WHEN** `translateLegacyTopic` is invoked for an unknown clientId
- **THEN** the function SHALL issue exactly one Prisma query (`Gateway.findFirst({ where: { clientId } })`)
- **AND** on success the cache SHALL store the mapping
- **AND** on failure (no matching Gateway) the function SHALL return `null` AND emit a structured warning

#### Scenario: Cache invalidation on Gateway.clientId change

- **GIVEN** the cache contains `'OLD_CLIENT_ID' → 'ck0042'`
- **WHEN** the tRPC `gateway.update` mutation changes a Gateway's clientId from `'OLD_CLIENT_ID'` to `'NEW_CLIENT_ID'`
- **THEN** the procedure SHALL call `cache.delete('OLD_CLIENT_ID')`
- **AND** subsequent lookups for `'NEW_CLIENT_ID'` SHALL re-fetch from Prisma

---

### Requirement: New-schema outbound topic SHALL be `controlai/{siteId}/{deviceKey}/{dataType}`

`formatNewTopic({ siteId, deviceKey, dataType })` SHALL return the string `'controlai/' + siteId + '/' + deviceKey + '/' + dataType`. `dataType ∈ { birth, data, death, cmd }`. The simulator SHALL use this format when publishing to a Site whose `driverId = 'mqtt-driver'` AND whose SiteGroup's `topicSchemaMode ∈ { 'dual', 'new' }`.

#### Scenario: Simulator publishes on new schema in dual mode

- **GIVEN** a SiteGroup with `topicSchemaMode = 'dual'`, a Site `s1` with `driverId = 'mqtt-driver'`, a registered Device `ck0042`
- **WHEN** the simulator emits an NDATA-equivalent message for `ck0042`
- **THEN** the published MQTT topic SHALL be `'controlai/s1/ck0042/data'`
- **AND** the payload SHALL be JSON-encoded
- **AND** mqtt-bridge subscribed to `controlai/s1/#` SHALL receive it and emit a NormalizedMessage with `sourceDriver: 'mqtt-driver'`

#### Scenario: Legacy mode keeps simulator on `modules/...` schema

- **GIVEN** a SiteGroup with `topicSchemaMode = 'legacy'`
- **WHEN** the simulator publishes
- **THEN** the published topic SHALL match `^modules/.+/(NBIRTH|NDATA|NDEATH)/[0-9A-F]{24}$`
- **AND** `formatNewTopic` SHALL NOT be invoked

---

### Requirement: SiteGroup.topicSchemaMode SHALL gate driver subscriptions and downstream payload shapes

The flag `SiteGroup.topicSchemaMode ∈ { 'legacy', 'dual', 'new' }` SHALL govern:

- mqtt-driver subscribes to `modules/#` in `legacy` and `dual`; only to `controlai/{siteId}/#` in `new`.
- redis-writer writes the legacy key format `{siteId}:{topic}` in `legacy` and `dual`; only the new key format `{siteId}:{deviceKey}:{dataType}` in `dual` and `new`.
- sse-fanout emits the legacy `{ topic, payload, ts }` shape in `legacy` and `dual`; only NormalizedMessage in `new`.
- tsdb-writer reads only the new key format (`{siteId}:{deviceKey}:{dataType}`) in all modes; in `legacy` mode it observes empty streams for that key format.

The mqtt-bridge orchestrator SHALL poll `SiteGroup.topicSchemaMode` every 30 seconds (cached) and reconcile its driver subscriptions on change. The change SHALL take effect within 60 seconds of the apply op committing.

#### Scenario: Flipping legacy → dual adds the new-schema subscription

- **GIVEN** an mqtt-driver-managed Site with `topicSchemaMode = 'legacy'` and one active MQTT subscription `modules/#`
- **WHEN** the apply op `migrateTopicSchema({ siteGroupId, mode: 'dual' })` commits
- **THEN** within 60 seconds the driver SHALL subscribe additionally to `controlai/<siteId>/#`
- **AND** existing `modules/#` subscription SHALL remain active
- **AND** redis-writer SHALL begin writing BOTH key formats

#### Scenario: Flipping dual → new drops the legacy subscription for non-DAEJAK SiteGroups

- **GIVEN** a SiteGroup containing no DAEJAK boards (all simulator + future devices), currently in `dual`
- **WHEN** `migrateTopicSchema({ siteGroupId, mode: 'new' })` commits
- **THEN** within 60 seconds the driver SHALL unsubscribe from `modules/#` for that SiteGroup's Sites
- **AND** redis-writer SHALL stop writing legacy key format
- **AND** sse-fanout SHALL stop emitting legacy shape events

#### Scenario: DAEJAK SiteGroups stay on `dual` because firmware is fixed

- **GIVEN** a SiteGroup containing at least one DAEJAK gateway Device
- **WHEN** an operator attempts `migrateTopicSchema({ siteGroupId, mode: 'new' })`
- **THEN** the apply op SHALL refuse with a clear error: "SiteGroup contains DAEJAK boards whose firmware publishes on legacy schema; remain in 'dual' mode"
- **AND** no DB mutation SHALL occur

---

### Requirement: tsdb-writer SHALL ingest NormalizedMessage from Redis Streams idempotently into `sensor_data` hypertable

`apps/tsdb-writer` SHALL run as a standalone service consuming Redis Streams via XREADGROUP. The consumer-group `tsdb-writer` SHALL be created per stream key on first read. Messages SHALL be parsed as `NormalizedMessage` (skip + warn on parse failure) and inserted into `sensor_data` with primary key `(site_id, device_key, ts, data_type)` using `ON CONFLICT DO NOTHING`. Throughput SHALL sustain ≥ 50,000 msg/s per writer instance.

#### Scenario: Single message lands in TSDB

- **GIVEN** an empty `sensor_data` table and a running tsdb-writer connected to Redis
- **WHEN** mqtt-bridge writes a NormalizedMessage `{ deviceKey: 'ck0042', dataType: 'data', ts: '2026-05-27T10:00:00Z', payload: { temperature: 22.5 } }` to Redis stream `siteA:ck0042:data`
- **THEN** within 1 second a row SHALL exist in `sensor_data` with `site_id = 'siteA'`, `device_key = 'ck0042'`, `data_type = 'data'`, `ts = '2026-05-27T10:00:00Z'`, `payload->>'temperature' = '22.5'`

#### Scenario: Retry of identical message is idempotent

- **GIVEN** the row from the prior scenario exists
- **WHEN** the same NormalizedMessage is re-delivered to the same Redis stream
- **THEN** the row count for `(siteA, ck0042, '2026-05-27T10:00:00Z', 'data')` SHALL remain exactly 1
- **AND** no SQL error SHALL be raised

#### Scenario: Throughput target

- **WHEN** mqtt-bridge writes 50,000 NormalizedMessages per second to a single SiteGroup's streams for 60 seconds
- **THEN** the tsdb-writer SHALL ingest all 3,000,000 messages within 75 seconds total
- **AND** `writer_consumer_lag_messages` Prometheus gauge SHALL return to 0 by the 75-second mark
- **AND** zero messages SHALL be lost (verified by source-id reconciliation)

---

### Requirement: Apply op `configureDriver` SHALL validate driverConfig against the driver's schema and persist on Site

The apply op `configureDriver({ siteId, driverId, driverConfig })` SHALL:

1. Resolve `getBrokerDriver(driverId)`; refuse if not registered.
2. Call `driver.validateConfig(driverConfig)`; refuse if `{ ok: false }`.
3. Update `Site.driverId` and `Site.driverConfig` in a transaction.
4. Write `AuditLog` row action `apply.configure-driver` with metadata `{ siteId, driverId, before: <prior values>, after: <new values> }`.

#### Scenario: configureDriver persists valid config

- **WHEN** `configureDriver({ siteId: 's1', driverId: 'mqtt-driver', driverConfig: { host: 'broker.example', port: 8883 } })` is applied
- **THEN** Site `s1` SHALL have `driverId = 'mqtt-driver'` and `driverConfig = { host: 'broker.example', port: 8883 }`
- **AND** an `AuditLog` row SHALL be written

#### Scenario: Invalid driverConfig rejected

- **GIVEN** mqtt-driver's `configSchema` requires `port: number`
- **WHEN** `configureDriver({ ..., driverConfig: { port: '8883' } })` is applied (string, not number)
- **THEN** the op SHALL throw an error including the Zod issue path
- **AND** Site rows SHALL be unchanged

---

### Requirement: Apply op `migrateTopicSchema` SHALL update SiteGroup.topicSchemaMode and refuse downgrades

The apply op `migrateTopicSchema({ siteGroupId, mode })` SHALL:

1. Verify `mode` ∈ `{ 'dual', 'new' }`. Refuse `'legacy'` (this op is forward-only).
2. Verify the requested transition is forward: `legacy → dual`, `legacy → new`, or `dual → new`. Refuse `dual → legacy` or `new → legacy`.
3. When transitioning to `'new'`, verify no DAEJAK gateway Device exists in the SiteGroup (a Device row whose `realUuid` matches `/^[0-9A-F]{24}$/`). Refuse if any.
4. UPDATE `SiteGroup.topicSchemaMode`.
5. Write `AuditLog` row action `apply.migrate-topic-schema` with `{ siteGroupId, before, after }`.

#### Scenario: Forward transition succeeds

- **WHEN** `migrateTopicSchema({ siteGroupId: 'sg1', mode: 'dual' })` is applied to a SiteGroup currently in `legacy`
- **THEN** SiteGroup `sg1` SHALL have `topicSchemaMode = 'dual'`

#### Scenario: Downgrade refused

- **WHEN** `migrateTopicSchema({ siteGroupId: 'sg1', mode: 'legacy' })` is applied
- **THEN** the op SHALL throw with a message naming the forward-only constraint

#### Scenario: New mode refused when DAEJAK board present

- **GIVEN** SiteGroup `sg1` contains a Device with `realUuid = '2C004A001351353230363438'`
- **WHEN** `migrateTopicSchema({ siteGroupId: 'sg1', mode: 'new' })` is applied
- **THEN** the op SHALL throw with a message referencing DAEJAK firmware constraints
- **AND** SiteGroup.topicSchemaMode SHALL remain unchanged

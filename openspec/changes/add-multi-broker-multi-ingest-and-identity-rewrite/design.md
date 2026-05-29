# Design: add-multi-broker-multi-ingest-and-identity-rewrite

## 1. Goals and non-goals

### Goals

- Refactor `apps/mqtt-bridge` into a thin orchestrator over a pluggable `BrokerDriver` registry. The mqtt path becomes one of four drivers (`mqtt-driver`, `kafka-driver`, `http-webhook-driver`, `tsdb-direct-driver`).
- Introduce a `NormalizedMessage` wire format `{ deviceKey, dataType, payload, ts, sourceTopic?, sourceDriver }` carried on Redis Streams, SSE, and tsdb-writer input. Downstream consumers operate on `device_key` exclusively.
- Translate inbound legacy `modules/{groupId}/{NBIRTH|NDATA|NDEATH}/{clientId}` topics into the normalized shape at mqtt-bridge ingress, via Gateway.clientId → deviceKey alias lookup.
- Adopt outbound topic schema `controlai/{siteId}/{deviceKey}/{dataType}` for simulator + future non-DAEJAK devices; legacy `modules/...` stays in place for DAEJAK boards (their firmware is fixed).
- Add `apps/tsdb-writer` consuming Redis Streams, writing to a single `sensor_data` hypertable partitioned by `(siteId, deviceKey)`, idempotent on retry, ≥ 50k msg/s per instance.
- Enforce the cross-spec invariant `device_key` is the routing key — even after spec 3's `realUuid` rewrites.
- Roll out via per-SiteGroup `topicSchemaMode` flag (`legacy | dual | new`) so existing live SiteGroups don't churn until ops flips them.

### Non-goals

- Outbound Kafka producer (v1 is consumer-only).
- OPC-UA pull driver.
- DB- or CDN-hosted driver plugins (v1 is in-repo TS).
- Cross-broker bridging (no inbound Kafka → outbound MQTT).
- Modifying board firmware to speak the new topic schema (firmware is fixed; spec stays purely on the cloud side).
- Replacing the existing daemon's PKI / per-tenant broker provisioning (untouched).

## 2. Component diagram

```mermaid
flowchart LR
    subgraph Boards [Devices]
        Daejak[DAEJAK board<br/>publishes modules/&lt;groupId&gt;/&lt;type&gt;/&lt;clientId&gt;]
        Future[Future device<br/>publishes controlai/&lt;siteId&gt;/&lt;deviceKey&gt;/&lt;type&gt;]
        Sim[Simulator<br/>publishes controlai/... per Site.driverId]
    end

    Daejak -- mqtt --> Broker[Per-Site MQTT broker]
    Future -- mqtt --> Broker
    Sim -- mqtt --> Broker

    Broker --> Bridge[apps/mqtt-bridge<br/>orchestrator + drivers]

    KafkaSrc[Kafka brokers]:::ext --> Bridge
    HttpSrc[Devices POST /ingest/&lt;siteId&gt;]:::ext --> Bridge

    Bridge -- NormalizedMessage --> Redis[(Redis Streams<br/>key {siteId}:{deviceKey}:{dataType})]
    Bridge -- NormalizedMessage --> SSE[SSE fanout → web]

    Redis --> Writer[apps/tsdb-writer<br/>consumer-group sharded]
    Writer -- INSERT --> TSDB[(TimescaleDB sensor_data<br/>hypertable, partition by siteId+deviceKey)]

    Bridge -. TsdbDirect optional .-> TSDB

    classDef ext fill:#fef3c7,stroke:#92400e;
```

## 3. NormalizedMessage shape

```ts
// packages/runtime-drivers/src/normalized-message.ts
export const NormalizedMessageSchema = z.object({
  deviceKey: z.string().cuid(),
  dataType: z.enum(['birth', 'data', 'death', 'cmd']),
  payload: z.unknown(),
  ts: z.string().datetime(),
  sourceTopic: z.string().optional(),
  sourceDriver: z.string(),         // 'mqtt-driver' | 'kafka-driver' | ...
});
export type NormalizedMessage = z.infer<typeof NormalizedMessageSchema>;
```

Carried on Redis Streams as a single JSON field. SSE event `data:` field is the same JSON. tsdb-writer parses + inserts.

## 4. BrokerDriver registry

```ts
// packages/runtime-drivers/src/schema.ts
export const BrokerDriverSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  displayName: z.string(),
  supportedSiteCapabilities: z.array(z.enum(['inbound', 'outbound', 'tsdb-direct'])),
  configSchema: z.custom<z.ZodSchema>(),               // each driver brings its own
  factory: z.function().args(z.unknown(), z.unknown()).returns(z.unknown()),
}).strict();

export interface BrokerDriverInstance {
  connect(): Promise<void>;
  subscribe(topicPattern: string, qos: 0|1|2, handler: (m: NormalizedMessage) => void): Promise<void>;
  publish(topic: string, payload: unknown, opts?: { qos?: 0|1|2; retain?: boolean }): Promise<void>;
  healthCheck(): Promise<{ status: 'ok'|'degraded'|'down'; lastError?: string }>;
  validateConfig(cfg: unknown): { ok: true; cfg: unknown } | { ok: false; reason: string };
  close(): Promise<void>;
}

// packages/runtime-drivers/src/registry.ts
const drivers = new Map<string, RegisteredBrokerDriver>();
export function registerBrokerDriver(d: RegisteredBrokerDriver): void { ... }
export function getBrokerDriver(id: string): RegisteredBrokerDriver { ... }
export function listBrokerDrivers(filter?: { capability?: string }): RegisteredBrokerDriver[] { ... }
```

Each driver is one folder `packages/runtime-drivers/drivers/<id>/index.ts` calling `registerBrokerDriver({ ... })` at import time. The aggregator `drivers/index.ts` imports them all. Same pattern + contract test as spec 1.

## 5. Topic translation

### 5.1 Legacy → normalized

```ts
// packages/runtime-drivers/src/topic-translator.ts
const cache = new LRUCache<string, string>({ max: 10_000, ttl: 5 * 60_000 });

export async function translateLegacyTopic(
  topic: string,
  payload: Buffer | unknown,
): Promise<NormalizedMessage | null> {
  const match = topic.match(/^modules\/[^/]+\/(NBIRTH|NDATA|NDEATH)\/([0-9A-F]{24})$/);
  if (!match) return null;
  const [, sparkplugType, clientId] = match;
  let deviceKey = cache.get(clientId);
  if (!deviceKey) {
    const gw = await prisma.gateway.findFirst({ where: { clientId }, select: { deviceKey: true } });
    if (!gw?.deviceKey) return null;     // unknown / unmigrated gateway
    cache.set(clientId, gw.deviceKey);
    deviceKey = gw.deviceKey;
  }
  const dataType = sparkplugType === 'NBIRTH' ? 'birth' : sparkplugType === 'NDEATH' ? 'death' : 'data';
  return {
    deviceKey,
    dataType,
    payload: decodeIfCbor(payload),
    ts: new Date().toISOString(),
    sourceTopic: topic,
    sourceDriver: 'mqtt-driver',
  };
}

export function formatNewTopic({ siteId, deviceKey, dataType }: {
  siteId: string; deviceKey: string; dataType: 'birth'|'data'|'death'|'cmd';
}): string {
  return `controlai/${siteId}/${deviceKey}/${dataType}`;
}

// Inverse helper for outbound: gateway-sourced messages from the simulator publish using deviceKey
// directly — no clientId lookup needed because simulator already has the Device row.
```

Cache invalidation: `Gateway.update` (existing tRPC mutation) calls `cache.delete(oldClientId)` for the row's previous clientId. The cache is process-local; mqtt-bridge runs N replicas and each holds its own cache, kept consistent via the 5-min TTL.

### 5.2 New schema decoding

For messages arriving on `controlai/{siteId}/{deviceKey}/{dataType}`, the driver parses the deviceKey segment directly. No DB lookup needed. Payload is assumed JSON for v1 (CBOR is legacy-only).

## 6. Per-SiteGroup topicSchemaMode flag

```
legacy → mqtt-bridge subscribes only to modules/#; translates inbound; publishes nothing on the new schema; redis-writer uses {siteId}:{topic} legacy key format.
dual   → mqtt-bridge subscribes to BOTH modules/# AND controlai/{siteId}/#; translates legacy inbound; new inbound passes through; simulator publishes on the new schema; redis-writer writes BOTH key formats; SSE emits BOTH payload shapes; tsdb-writer reads new key format only.
new    → mqtt-bridge subscribes only to controlai/{siteId}/#; legacy translation is OFF (rejected with a warning log); redis-writer writes new key format only; SSE emits new shape only.
```

The flag is set per-SiteGroup. Default `legacy` for existing SiteGroups; `dual` for new ones; `new` is opt-in via the `migrateTopicSchema` apply op. The flag is stored in `SiteGroup.topicSchemaMode`. mqtt-bridge polls this every 30s (cheap query + cached) and reconciles its subscriptions.

## 7. apps/tsdb-writer

### 7.1 Schema

```sql
-- apps/tsdb-writer/src/schema.sql
CREATE TABLE IF NOT EXISTS sensor_data (
  site_id     text        NOT NULL,
  device_key  text        NOT NULL,
  ts          timestamptz NOT NULL,
  data_type   text        NOT NULL,
  payload     jsonb       NOT NULL,
  source_topic text,
  source_driver text       NOT NULL,
  PRIMARY KEY (site_id, device_key, ts, data_type)
);

SELECT create_hypertable('sensor_data', 'ts', partitioning_column => 'site_id',
                          number_partitions => 16, if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_sensor_data_device_ts ON sensor_data (device_key, ts DESC);

-- Continuous aggregates (1m / 1h / 1d) created per Site.retentionPeriod tier.
-- Templates live in src/migrations/ and are applied via node-pg-migrate.
```

`ON CONFLICT DO NOTHING` makes inserts idempotent across retries: a re-delivered message with identical `(site_id, device_key, ts, data_type)` is a no-op.

### 7.2 Consumer

```ts
// apps/tsdb-writer/src/consumer.ts
const groupId = 'tsdb-writer';

for (const siteId of activeSites) {
  await redis.xgroup('CREATE', `${siteId}:*`, groupId, '$', 'MKSTREAM').catch(() => {});
  // consumer reads with XREADGROUP > 100 messages per pass per Site
}

async function processBatch(batch: { stream: string; messages: any[] }[]) {
  const rows: SensorDataRow[] = [];
  for (const { stream, messages } of batch) {
    for (const m of messages) {
      const msg = NormalizedMessageSchema.parse(JSON.parse(m.payload));
      const siteId = stream.split(':')[0];
      rows.push({ site_id: siteId, device_key: msg.deviceKey, ts: msg.ts, data_type: msg.dataType,
                  payload: msg.payload, source_topic: msg.sourceTopic, source_driver: msg.sourceDriver });
    }
  }
  if (rows.length > 0) await pg.batchInsert('sensor_data', rows, { onConflictDoNothing: true });
  await redis.xack(...messages);
  // Bump Device.lastSeenAt for distinct deviceKeys observed in this batch (throttled to once per 30s per deviceKey via in-mem map)
}
```

### 7.3 Performance budget

- Sustained per writer instance: ≥ 50,000 msg/s with batches of ≤ 500 rows.
- Latency p95: ≤ 200ms publish-on-Redis → row-visible-in-TSDB.
- Horizontal scale: add writer replicas; Redis consumer group rebalances Sites across them.

## 8. apply-planner extensions

```mermaid
flowchart TD
    A[synthesizePlan] --> B{for each broker node}
    B --> C[createTenant + createSite + issueCert<br/>existing ops]
    C --> D[NEW: configureDriver<br/>{ siteId, driverId, driverConfig }]
    A --> E{for each SiteGroup<br/>w/ topicSchemaMode != current}
    E --> F[NEW: migrateTopicSchema<br/>{ siteGroupId, mode }]
```

`configureDriver` op:

- Input `{ siteId, driverId, driverConfig }`.
- Validates `driverConfig` via `getBrokerDriver(driverId).validateConfig(...)`.
- UPDATE Site SET driverId, driverConfig.
- Audit row.

`migrateTopicSchema` op:

- Input `{ siteGroupId, mode: 'dual' | 'new' }`.
- UPDATE SiteGroup SET topicSchemaMode.
- Audit row including before/after.
- mqtt-bridge picks up the change on its 30s reconciliation tick.

## 9. Dashboard adapter

```ts
// apps/web/lib/dashboard/sse-adapter.ts
export function adaptSseEvent(raw: any): NormalizedMessage | null {
  if (raw && raw.deviceKey && raw.dataType) return raw as NormalizedMessage;  // new shape
  if (raw && raw.topic && raw.payload) {
    // legacy shape; resolve via in-page Gateway clientId cache
    const m = /^modules\/[^/]+\/(N(?:BIRTH|DATA|DEATH))\/([0-9A-F]{24})$/.exec(raw.topic);
    if (!m) return null;
    const deviceKey = useDeviceKeyByClientId(m[2]);   // hook-resolved
    if (!deviceKey) return null;
    return { deviceKey, dataType: m[1] === 'NBIRTH' ? 'birth' : m[1] === 'NDEATH' ? 'death' : 'data',
             payload: raw.payload, ts: raw.ts ?? new Date().toISOString(),
             sourceTopic: raw.topic, sourceDriver: 'legacy-shim' };
  }
  return null;
}
```

After `topicSchemaMode = 'new'` is global, this shim is removed.

## 10. Migration sequence

```mermaid
sequenceDiagram
    autonumber
    participant Ops
    participant DB
    participant Bridge
    participant Sim
    participant Writer
    participant Web

    Ops->>DB: deploy migrations (Site.driverId, SiteGroup.topicSchemaMode, sensor_data)
    Ops->>Writer: deploy apps/tsdb-writer (off by default; reads from Redis but topicSchemaMode=legacy → no new-shape data yet)
    Ops->>Bridge: deploy new mqtt-bridge orchestrator; topicSchemaMode=legacy → behaves as today
    Ops->>Sim: deploy new simulator; per-Site driverId; topicSchemaMode=legacy → publishes on modules/...
    Ops->>Web: deploy SSE adapter; dashboards consume both shapes
    Ops->>DB: per SiteGroup: migrateTopicSchema(dual)
    Bridge-->>Bridge: subscribe controlai/{siteId}/#; translate legacy; emit both shapes
    Sim-->>Sim: publish controlai/...
    Writer-->>TSDB: row inserts begin (new shape only)
    note over Ops: observe one minor release for stability; then
    Ops->>DB: per SiteGroup: migrateTopicSchema(new)
    Bridge-->>Bridge: drop modules/# subscription for that SiteGroup
    note over Bridge,Sim: DAEJAK boards still publish on modules/ — handled by sibling SiteGroups still in dual mode OR by leaving legacy subscription on per Site config
```

Caveat: DAEJAK boards CANNOT be flipped to `new` mode because their firmware is fixed. The deploy strategy is: SiteGroups containing DAEJAK boards stay in `dual` indefinitely (so mqtt-bridge keeps translating their legacy topics); SiteGroups containing only non-DAEJAK devices (future) can move to `new`. This means the `legacy` mode is also retained indefinitely as the "DAEJAK-only fallback" but **only mqtt-bridge subscribes to it; nothing else in the new pipeline cares because the translator converts everything to normalized shape**.

In other words: the `topicSchemaMode` flag affects what mqtt-bridge SUBSCRIBES to AND what redis-writer/SSE emit. The DAEJAK reality is just `topicSchemaMode = 'dual'` permanently for affected SiteGroups, with the understanding that "new schema" outbound traffic from those SiteGroups comes only from the simulator + future non-DAEJAK devices.

## 11. Observability

- mqtt-bridge: structured logs per emitted NormalizedMessage at debug; counter `bridge_messages_total{driverId, dataType, siteId}`; histogram `bridge_translation_latency_ms`.
- tsdb-writer: counter `writer_inserts_total{siteId}`; histogram `writer_batch_size`, `writer_pg_insert_latency_ms`; gauge `writer_consumer_lag_messages{siteId}`.
- OpenTelemetry: a span per message from driver receive → redis-write → SSE-fanout → tsdb-write. Correlation by `deviceKey` + `ts`.
- Audit rows for every `configureDriver` and `migrateTopicSchema` apply op.

## 12. Open questions deferred

| Question                                                                                          | Where it lands |
| ------------------------------------------------------------------------------------------------- | -------------- |
| Outbound Kafka producer (publishing commands or aggregated rollups)                               | Future         |
| OPC-UA driver                                                                                     | Future         |
| Plugin manifest distribution outside in-repo TS modules                                           | Future         |
| Cross-broker bridging (Kafka inbound → MQTT outbound to another Site)                             | Future         |
| Eventual deprecation of `topicSchemaMode = legacy` (depends on DAEJAK firmware update lifecycle)  | Future         |
| Strong-consistency on driverConfig hot reloads (today: 30s reconcile tick is eventual)            | Future         |

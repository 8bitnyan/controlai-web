---
name: "Multi-broker driver registry, multi-ingest paths, TSDB writer, topic-schema migration"
overview: "Refactor apps/mqtt-bridge into a thin orchestrator over a new packages/runtime-drivers BrokerDriver registry (mqtt-driver, kafka-driver, http-webhook-driver, tsdb-direct-driver). Introduce a NormalizedMessage wire format (deviceKey + dataType + payload + ts + sourceDriver) on Redis Streams, SSE, and a brand-new apps/tsdb-writer service that ingests into a TimescaleDB sensor_data hypertable idempotently. Translate inbound legacy `modules/{groupId}/{NBIRTH|NDATA|NDEATH}/{clientId}` topics into NormalizedMessage at ingress via Gateway.clientId→deviceKey lookup. Adopt outbound `controlai/{siteId}/{deviceKey}/{dataType}` topic schema for simulator + future non-DAEJAK devices. Per-SiteGroup topicSchemaMode flag (legacy|dual|new) gates rollout. Two new apply ops (configureDriver, migrateTopicSchema) wire the planner + commit handler. Dashboard SSE adapter normalizes both shapes during the dual-stack window. This is the LAST spec in the four-change sequence and ENFORCES the cross-spec invariant `device_key is the operational routing key`."
created: "2026-05-27T00:00:00Z"
last_updated: "2026-05-27T00:00:00Z"
isProject: false
type: "spec"
change_id: "add-multi-broker-multi-ingest-and-identity-rewrite"
plan_status: "draft"
trigger: "apply add-multi-broker-multi-ingest-and-identity-rewrite"
todos:
  - id: precondition-specs-1-2-3-applied
    content: "Confirm specs 1, 2, 3 (device-type registry, unregistered device lifecycle, gateway register handshake) are applied — Device model, Gateway.deviceKey, deviceKey CUIDs exist."
    status: pending
  - id: shared-types-apply-ops-tests
    content: "Write tests in packages/shared-types/__tests__/apply.spec.ts asserting configureDriver and migrateTopicSchema Op schemas validate + reject malformed input, BrokerDriverIdSchema + TopicSchemaModeSchema enforced."
    status: pending
  - id: shared-types-apply-ops-impl
    content: "Extend packages/shared-types/src/apply.ts: add 'configureDriver' and 'migrateTopicSchema' to OP_TYPES enum; add BrokerDriverIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/); add TopicSchemaModeSchema = z.enum(['legacy','dual','new'])."
    status: pending
  - id: prisma-schema-site-driver-config
    content: "Edit packages/db/prisma/schema.prisma: Site adds driverId String? @default('mqtt-driver'), driverConfig Json?, ingestModeJson Json?; SiteGroup adds topicSchemaMode String @default('legacy')."
    status: pending
  - id: prisma-migration-add-site-driver-config
    content: "Generate Prisma migration with `pnpm --filter @controlai-web/db prisma migrate dev --name add-site-driver-config`. Commit migration SQL."
    status: pending
  - id: runtime-drivers-package-scaffold
    content: "Create packages/runtime-drivers/ workspace package: package.json, tsconfig.json, src/index.ts barrel, vitest config. Match @controlai-web/shared-types build setup (tsup format cjs/esm/dts)."
    status: pending
  - id: runtime-drivers-schema-impl
    content: "Create packages/runtime-drivers/src/schema.ts: BrokerDriverSchema (Zod strict — id, displayName, supportedSiteCapabilities, configSchema, factory), BrokerDriverInstance interface (connect/subscribe/publish/healthCheck/validateConfig/close). ~120 LOC."
    status: pending
  - id: runtime-drivers-schema-tests
    content: "Tests packages/runtime-drivers/src/__tests__/schema.spec.ts: schema accepts valid driver, rejects missing configSchema with path ['configSchema'], rejects invalid id regex. ≥8 cases."
    status: pending
  - id: runtime-drivers-normalized-message-impl
    content: "Create packages/runtime-drivers/src/normalized-message.ts: NormalizedMessageSchema (deviceKey cuid, dataType enum birth|data|death|cmd, payload unknown, ts ISO8601 datetime, sourceTopic optional, sourceDriver). Export type."
    status: pending
  - id: runtime-drivers-normalized-message-tests
    content: "Tests __tests__/normalized-message.spec.ts: valid message parses, invalid dataType rejected with ZodError, missing deviceKey rejected. ≥6 cases."
    status: pending
  - id: runtime-drivers-registry-impl
    content: "Create packages/runtime-drivers/src/registry.ts: in-memory Map<string, RegisteredBrokerDriver>; registerBrokerDriver (throws on duplicate id with hint to first call site), getBrokerDriver (throws on unknown id), listBrokerDrivers({capability?}). Mirror NODE_TYPES pattern in shared-types/node-types.ts. ~120 LOC."
    status: pending
  - id: runtime-drivers-registry-tests
    content: "Tests __tests__/registry.spec.ts: register + get + list happy path; duplicate id throws with message 'Duplicate broker-driver id: X'; getBrokerDriver unknown throws; listBrokerDrivers filter by capability. ≥10 cases."
    status: pending
  - id: runtime-drivers-topic-translator-impl
    content: "Create packages/runtime-drivers/src/topic-translator.ts: LRU cache (max=10000, ttl=5min) keyed on clientId→deviceKey; translateLegacyTopic(topic, payload) matches /^modules\\/[^/]+\\/(NBIRTH|NDATA|NDEATH)\\/([0-9A-F]{24})$/, looks up Gateway.findFirst({where:{clientId},select:{deviceKey:true}}), decodes CBOR if Buffer first byte indicates CBOR, returns NormalizedMessage|null; formatNewTopic({siteId,deviceKey,dataType}) returns string; export cache.delete(clientId) for invalidation. ~140 LOC."
    status: pending
  - id: runtime-drivers-topic-translator-tests
    content: "Tests __tests__/topic-translator.spec.ts: legacy NBIRTH/NDATA/NDEATH translate correctly with cached deviceKey (no Prisma call); cache miss issues Prisma query and caches; unknown clientId returns null + structured warning; non-matching topic returns null; formatNewTopic round-trip; cache.delete invalidates. ≥12 cases."
    status: pending
  - id: runtime-drivers-driver-conformance-suite
    content: "Create packages/runtime-drivers/src/__tests__/driver-conformance-suite.ts: factory `runDriverConformance(factory: () => BrokerDriverInstance, opts)` returning ~12 shared cases — connect/close lifecycle, subscribe + handler invoked, publish-throws-on-unsupported, healthCheck shape, validateConfig accept/reject. ~140 LOC."
    status: pending
  - id: mqtt-driver-impl
    content: "Create packages/runtime-drivers/drivers/mqtt-driver/: index.ts (side-effect registerBrokerDriver call), config-schema.ts (Zod: host, port, tls{ca,cert,key}?, clientIdPrefix?, qos 0|1|2, servername?), instance.ts wrapping `mqtt.js`. Subscribes to modules/# in legacy/dual, controlai/{siteId}/# in dual/new (per SiteGroup.topicSchemaMode passed in). Decode CBOR for legacy topics via shared topic-translator; pass JSON for new topics. Outbound publish via formatNewTopic. Reconnect backoff 1s–30s. NO hardcoded port 8883 (driverConfig.port required). ~280 LOC."
    status: pending
  - id: mqtt-driver-tests
    content: "Tests packages/runtime-drivers/drivers/mqtt-driver/__tests__/: runs driver-conformance-suite against embedded test broker (aedes or vitest mqtt-mock); subscribe-in-legacy → only modules/# subscription; subscribe-in-dual → both subscriptions; decode CBOR for golden NBIRTH fixture (create one based on apps/simulator/src/cbor-codec.ts encodeNbirth output); reject invalid config (port string). ~200 LOC. Includes golden fixture file."
    status: pending
  - id: kafka-driver-impl
    content: "Create packages/runtime-drivers/drivers/kafka-driver/: config-schema.ts (brokers[], saslMechanism?, saslUsername?, saslPassword?, groupId, topics[], jsonMapper:{deviceKeyPath, dataTypePath, payloadPath, tsPath?}), instance.ts wrapping `kafkajs` consumer. Apply jsonMapper to each consumed message to build NormalizedMessage. publish() throws Error('kafka-driver does not support publish in v1'). ~240 LOC. Add kafkajs dep."
    status: pending
  - id: kafka-driver-tests
    content: "Tests packages/runtime-drivers/drivers/kafka-driver/__tests__/: conformance suite (publish skip asserts sentinel error); JSON mapper extracts deviceKey/dataType/payload via configured paths; missing deviceKey path emits with deviceKey:null + structured warning; saslMechanism validation. ~180 LOC."
    status: pending
  - id: http-webhook-driver-impl
    content: "Create packages/runtime-drivers/drivers/http-webhook-driver/: config-schema.ts (secret, jsonMapper, requireHmac:boolean, allowedSkewSec:number=300), instance.ts exposing handle(request, siteId)→Promise<NormalizedMessage|Response>. HMAC-SHA256 via node:crypto on header X-Controlai-Signature; timestamp replay protection (≤5min skew). NO network listener — orchestrator mounts handler under POST /ingest/:siteId. ~180 LOC."
    status: pending
  - id: http-webhook-driver-tests
    content: "Tests packages/runtime-drivers/drivers/http-webhook-driver/__tests__/: valid HMAC + valid mapping → NormalizedMessage; bad HMAC → 401; stale timestamp → 401; missing signature when requireHmac=true → 401; malformed JSON → 400; jsonMapper extraction. ~160 LOC."
    status: pending
  - id: tsdb-direct-driver-impl
    content: "Create packages/runtime-drivers/drivers/tsdb-direct-driver/: config-schema.ts (pgUrl, batchSize default 500, idempotencyKey style), instance.ts implementing BrokerDriverInstance shim that exposes writeDirect(messages: NormalizedMessage[])→Promise<void>. Subscribe/publish throw 'tsdb-direct-driver is not a transport driver; invoked synchronously by orchestrator when Site.ingestModeJson opts in'. ~160 LOC."
    status: pending
  - id: tsdb-direct-driver-tests
    content: "Tests packages/runtime-drivers/drivers/tsdb-direct-driver/__tests__/: conformance suite (subscribe/publish throw sentinel); writeDirect inserts batch idempotently against testcontainers PG; validateConfig accept/reject. ~120 LOC."
    status: pending
  - id: drivers-aggregator-impl
    content: "Create packages/runtime-drivers/drivers/index.ts with side-effect imports for all 4 v1 drivers (mqtt-driver, kafka-driver, http-webhook-driver, tsdb-direct-driver). Export nothing — pure side effect. packages/runtime-drivers/src/index.ts re-exports schema + registry + normalized-message + topic-translator and imports the drivers aggregator."
    status: pending
  - id: tsdb-writer-package-scaffold
    content: "Create apps/tsdb-writer/ package: package.json (deps: ioredis, pg, prom-client, hono, @controlai-web/runtime-drivers, @controlai-web/shared-types; devDep: node-pg-migrate, testcontainers), tsconfig.json, Dockerfile mirroring apps/mqtt-bridge/Dockerfile structure, .env.example (TSDB_WRITER_PG_URL, TSDB_WRITER_PORT=4002, UPSTASH_REDIS_URL/TOKEN, ENABLE_TSDB_WRITER), README.md stub."
    status: pending
  - id: tsdb-writer-hypertable-migration
    content: "Create apps/tsdb-writer/src/migrations/001-initial.sql per design §7.1: sensor_data table (site_id, device_key, ts, data_type, payload jsonb, source_topic, source_driver, PRIMARY KEY (site_id, device_key, ts, data_type)); create_hypertable on ts with site_id partitioning + 16 partitions; idx_sensor_data_device_ts on (device_key, ts DESC). Wire node-pg-migrate; add `pnpm --filter @controlai-web/tsdb-writer migrate` script."
    status: pending
  - id: tsdb-writer-pg-helper-impl
    content: "Create apps/tsdb-writer/src/pg.ts: pg.Pool wrapping TSDB_WRITER_PG_URL; batchInsert(table, rows, {onConflictDoNothing}) using multi-row INSERT … ON CONFLICT DO NOTHING; getPool/closePool lifecycle. ~80 LOC."
    status: pending
  - id: tsdb-writer-consumer-impl
    content: "Create apps/tsdb-writer/src/consumer.ts: enumerate active Sites (Prisma); per Site, XGROUP CREATE consumer-group 'tsdb-writer' on stream pattern {siteId}:*; XREADGROUP loop with batch ≤500 messages; parse NormalizedMessageSchema (skip+warn on parse failure); batchInsert into sensor_data with ON CONFLICT DO NOTHING; XACK on success; throttled Device.lastSeenAt update once per 30s per deviceKey via in-mem map. Prom counter writer_inserts_total{siteId}; histogram writer_pg_insert_latency_ms; gauge writer_consumer_lag_messages{siteId}. ~280 LOC."
    status: pending
  - id: tsdb-writer-server-impl
    content: "Create apps/tsdb-writer/src/index.ts + src/server.ts: Hono HTTP server on TSDB_WRITER_PORT (default 4002); GET /health returning {status, activeSites, totalLag}; GET /metrics returning prom-client registry; spawn consumer on boot when ENABLE_TSDB_WRITER=true. ~120 LOC."
    status: pending
  - id: tsdb-writer-consumer-tests
    content: "Tests apps/tsdb-writer/src/__tests__/consumer.spec.ts using testcontainers TimescaleDB image + ioredis-mock: publish 10,000 NormalizedMessages over 5s to a single site stream, assert all 10,000 rows visible in sensor_data; re-publish same batch and assert zero duplicate rows (idempotency); refresh 1m continuous aggregate and assert rows present; malformed JSON skip+warn path. ~320 LOC."
    status: pending
  - id: tsdb-writer-deploy-config
    content: "Create deploy/tsdb-writer/ mirroring deploy/mqtt-bridge/: Dockerfile already in app; fly.toml or k8s manifest; healthcheck on /health. Add CI pipeline entry to typecheck + test."
    status: pending
  - id: mqtt-bridge-orchestrator-impl
    content: "Create apps/mqtt-bridge/src/orchestrator.ts: load each managed Site via existing broker-registry pattern (refactored to read Site.driverId + Site.driverConfig); resolve getBrokerDriver(driverId); instantiate via driver factory; wire emitted NormalizedMessage stream into redis-writer + sse-fanout + (optionally per Site.ingestModeJson) tsdb-direct-driver.writeDirect; poll SiteGroup.topicSchemaMode every 30s and reconcile subscriptions on change. Replaces apps/mqtt-bridge/src/mqtt-manager.ts (kept as deprecation shim re-exporting orchestrator). ~360 LOC."
    status: pending
  - id: mqtt-bridge-ingress-translator-impl
    content: "Create apps/mqtt-bridge/src/ingress-translator.ts: per emitted driver message, route through translateLegacyTopic for legacy `modules/` topic strings; new-schema topics pass straight through unchanged; emit NormalizedMessage to downstream bus. Histogram bridge_translation_latency_ms. ~120 LOC."
    status: pending
  - id: mqtt-bridge-redis-writer-dualstack-impl
    content: "Modify apps/mqtt-bridge/src/redis-writer.ts: new writeNormalizedMessage(siteId, normalizedMsg) using key {siteId}:{deviceKey}:{dataType}; keep legacy writeMessage(siteId, topic, payload) using key {siteId}:{topic}; orchestrator decides which to call based on SiteGroup.topicSchemaMode (legacy→legacy only, dual→both, new→new only). MAXLEN ~1000 stays. ~80 LOC delta."
    status: pending
  - id: mqtt-bridge-redis-writer-tests
    content: "Create apps/mqtt-bridge/__tests__/redis-writer.spec.ts (NEW — none today): legacy mode writes only legacy key; dual mode writes both keys; new mode writes only new key; XADD payload JSON-encoded; MAXLEN respected. ~120 LOC. Uses ioredis-mock."
    status: pending
  - id: mqtt-bridge-sse-fanout-dualstack-impl
    content: "Modify apps/mqtt-bridge/src/sse-fanout.ts: default emit() now sends NormalizedMessage JSON on data: field; add emitLegacy(siteId, legacyMessage) sending parallel `event: legacy\\ndata: {topic, payload, ts}\\n\\n` event for dual-mode backwards compat. EventEmitter listener cap stays 200. ~80 LOC delta."
    status: pending
  - id: mqtt-bridge-sse-fanout-tests
    content: "Create apps/mqtt-bridge/__tests__/sse-fanout.spec.ts: emit normalized → subscribers receive normalized; emitLegacy → subscribers receive event:legacy; subscriberCount tracks correctly. ~100 LOC."
    status: pending
  - id: mqtt-bridge-broker-registry-update-impl
    content: "Modify apps/mqtt-bridge/src/broker-registry.ts: drop hardcoded mqttPort=8883; instead load Site.driverId + Site.driverConfig + Site.ingestModeJson; return DriverConfigBundle for orchestrator to feed into driver factory. CA cert fetch logic preserved for mqtt-driver only (gated on driverId==='mqtt-driver'). ~80 LOC delta."
    status: pending
  - id: mqtt-bridge-broker-registry-tests
    content: "Create apps/mqtt-bridge/__tests__/broker-registry.spec.ts: returns DriverConfigBundle for mqtt-driver site; returns kafka-driver config without CA cert fetch; null on unknown site. ~80 LOC."
    status: pending
  - id: mqtt-bridge-http-ingest-route-impl
    content: "Modify apps/mqtt-bridge/src/server.ts: add POST /ingest/:siteId route delegating to per-Site http-webhook-driver instance via orchestrator.getDriver(siteId).handle(request, siteId); validate via driver, push resulting NormalizedMessage through ingress bus. ~60 LOC delta."
    status: pending
  - id: mqtt-bridge-http-ingest-tests
    content: "Add to apps/mqtt-bridge/__tests__/server.spec.ts (or new test file): POST /ingest/:siteId with valid HMAC + body → 202 + NormalizedMessage emitted; bad signature → 401; site without http-webhook-driver configured → 404. ~100 LOC."
    status: pending
  - id: mqtt-bridge-orchestrator-tests
    content: "Create apps/mqtt-bridge/__tests__/orchestrator.spec.ts: embedded test broker (aedes) + ioredis-mock + Prisma test factory; legacy mode subscribes only modules/# and writes legacy redis key + legacy SSE; dual mode subscribes both, writes both, emits both SSE shapes; flip SiteGroup.topicSchemaMode and verify 30s reconciliation tick updates subscriptions; driver-config validation rejects bad shape with clear error. ~280 LOC."
    status: pending
  - id: mqtt-bridge-mqtt-manager-deprecate
    content: "Convert apps/mqtt-bridge/src/mqtt-manager.ts into thin shim re-exporting from orchestrator with @deprecated JSDoc + console.warn on import; delete hardcoded port 8883 + topic '#' + qos 1 (now in mqtt-driver config). All real logic now lives in packages/runtime-drivers/drivers/mqtt-driver."
    status: pending
  - id: simulator-outbound-topic-switch-impl
    content: "Modify apps/simulator/src/manager.ts: at publish time look up Site.driverId + SiteGroup.topicSchemaMode via Prisma (cached per gateway); if driverId==='mqtt-driver' AND topicSchemaMode∈{'dual','new'} use formatNewTopic({siteId,deviceKey,dataType}) + JSON encode; if topicSchemaMode==='legacy' OR driverConfig.cborParity===true keep CBOR + modules/{groupId}/{msgType}/{clientId}; else throw NotSupported. Replaces lines 156–210 of manager.ts. ~140 LOC delta."
    status: pending
  - id: simulator-tests
    content: "Create apps/simulator/src/__tests__/manager.spec.ts (or update existing): legacy mode → publishes on modules/ schema CBOR; dual mode → publishes on controlai/ schema JSON; new mode → publishes on controlai/ schema JSON only; kafka driver → throws NotSupported. ~80 LOC. Use mqtt-mock fixture."
    status: pending
  - id: apply-planner-new-ops-impl
    content: "Modify packages/api/src/lib/apply-planner.ts: after existing createSite/issueCert ops in the broker-node loop emit `configureDriver({siteId, driverId: node.data.driverId ?? 'mqtt-driver', driverConfig: node.data.config})`; after timescale loop iterate SiteGroups and emit `migrateTopicSchema({siteGroupId, mode})` when explicit toolbar action set node.data.targetTopicSchemaMode. ~120 LOC delta. Use existing makeOp() factory."
    status: pending
  - id: apply-planner-tests
    content: "Add tests to packages/api/src/lib/__tests__/apply-planner.spec.ts (create if absent): broker node → ops sequence ends with configureDriver; canvas with no targetTopicSchemaMode → zero migrateTopicSchema ops; broker node with kafka driverId → configureDriver uses kafka; plan hash stable on identical input. ~120 LOC."
    status: pending
  - id: apply-handlers-configure-driver-impl
    content: "Modify packages/api/src/routers/apply.ts executeOp dispatch + the daemon executor: configureDriver path resolves getBrokerDriver(driverId), runs driver.validateConfig(driverConfig) (refuse on {ok:false}), prisma.site.update({driverId, driverConfig}) in transaction, writeAudit(action:'apply.configure-driver'). NOT a daemon REST call — pure DB op. ~80 LOC delta."
    status: pending
  - id: apply-handlers-migrate-topic-schema-impl
    content: "Modify packages/api/src/routers/apply.ts: migrateTopicSchema handler verifies mode ∈ {'dual','new'} (refuse 'legacy' — forward-only), verifies transition is forward (legacy→dual|new, dual→new), refuses 'new' when any Gateway in SiteGroup has clientId matching /^[0-9A-F]{24}$/ (DAEJAK guard); prisma.siteGroup.update({topicSchemaMode}); writeAudit(action:'apply.migrate-topic-schema'). ~80 LOC delta."
    status: pending
  - id: apply-handlers-tests
    content: "Extend packages/api/src/routers/__tests__/apply.spec.ts (create if absent): configureDriver persists valid config + writes audit; configureDriver with bad config throws ZodError; migrateTopicSchema legacy→dual succeeds; downgrade dual→legacy refused; new mode refused when DAEJAK gateway present; audit log row written for each. ~140 LOC."
    status: pending
  - id: gateway-update-cache-invalidate-impl
    content: "Modify packages/api/src/routers/gateway.ts update mutation: when clientId field is being changed, call topicTranslatorCache.delete(oldClientId) from @controlai-web/runtime-drivers (existing module-level singleton); also (gap fix) call writeAudit(action:'gateway.update') with {before, after} metadata. ~30 LOC delta."
    status: pending
  - id: gateway-update-tests
    content: "Add to packages/api/src/routers/__tests__/gateway.spec.ts (create if absent): clientId change invokes cache.delete(oldClientId); cache.delete not called when other fields change; audit log written. ~80 LOC."
    status: pending
  - id: web-sse-adapter-impl
    content: "Create apps/web/lib/dashboard/sse-adapter.ts per design §9: adaptSseEvent(raw) returns NormalizedMessage|null — passes new shape through; for legacy {topic, payload, ts} shape parses modules/.../<clientId> regex and resolves deviceKey via in-page useDeviceKeyByClientId() hook (or returns null when unresolvable). ~80 LOC."
    status: pending
  - id: web-sse-adapter-tests
    content: "Tests apps/web/lib/dashboard/__tests__/sse-adapter.spec.ts: new shape passes through; legacy shape with cached deviceKey adapts; legacy shape unknown clientId returns null; malformed input returns null. ~120 LOC."
    status: pending
  - id: web-use-site-stream-adapter-impl
    content: "Modify apps/web/hooks/use-site-stream.ts: pipe parsed message through adaptSseEvent before invoking onMessage; widget consumers receive only NormalizedMessage; if adapter returns null, drop + dev-warn. ~40 LOC delta."
    status: pending
  - id: web-use-site-stream-tests
    content: "Tests apps/web/hooks/__tests__/use-site-stream.spec.ts: legacy event → adapter normalizes → onMessage receives NormalizedMessage; new event passes through unchanged; null adapter result not propagated. ~80 LOC."
    status: pending
  - id: web-widget-consumer-migration
    content: "Modify apps/web/components/dashboard/widgets/sensor-io-stream.tsx + last-n-messages.tsx + status-board.tsx: replace `data.topic` lookups with `data.deviceKey + data.dataType` against NormalizedMessage; outbound pane reads deviceKey from new shape. Topic-filter logic at sensor-io-stream.tsx:260–268 becomes deviceKey + dataType filter. ~120 LOC delta across 3 files."
    status: pending
  - id: web-apply-modal-new-ops-impl
    content: "Modify apps/web/components/canvas/apply-modal.tsx: extend the op-description map at lines 139–144 to render configureDriver as 'Configure driver: {driverId} on Site {siteName}' and migrateTopicSchema as 'Topic schema: {before}→{after}' (with colored pill in OpList). ~60 LOC delta."
    status: pending
  - id: web-canvas-topic-schema-pill-impl
    content: "Modify apps/web/components/canvas/canvas.tsx toolbar (insert near SSE status pill at lines 324–338): small read-only pill showing current SiteGroup.topicSchemaMode (legacy=gray, dual=amber, new=green). Admin role gets dropdown menu 'Migrate schema…' opening confirmation dialog that sets node.data.targetTopicSchemaMode (picked up by apply-planner on next preview). ~80 LOC delta."
    status: pending
  - id: web-canvas-pill-tests
    content: "Tests apps/web/components/canvas/__tests__/topic-schema-pill.spec.tsx: pill renders correct label/color per mode; admin sees dropdown; non-admin does not; clicking 'Migrate schema → dual' updates node data + invalidates apply preview. ~100 LOC."
    status: pending
  - id: docs-driver-authoring
    content: "Create docs/driver-authoring.md: how to add a new BrokerDriver — folder layout, registerBrokerDriver call, config-schema.ts, conformance suite invocation. Mirror spec 1's manifest-authoring doc."
    status: pending
  - id: docs-topic-schema-migration
    content: "Create docs/topic-schema-migration.md: operator-facing per-SiteGroup migration guide following migration-checklist.md phases (pre-deploy, dual, new, DAEJAK constraint)."
    status: pending
  - id: docs-readmes
    content: "Update apps/mqtt-bridge/README.md (orchestrator architecture, driver registry, env vars) and create apps/tsdb-writer/README.md (purpose, env vars, deploy, scaling)."
    status: pending
  - id: deprecation-markers
    content: "Add @deprecated JSDoc + console.warn to: redis-writer.ts legacy writeMessage path (refers to follow-up ticket); sse-fanout.ts legacy emitLegacy path; mqtt-manager.ts shim. NO removal in this change."
    status: pending
  - id: validation-gate-typecheck
    content: "Run `pnpm -r typecheck` clean across all touched packages."
    status: pending
  - id: validation-gate-tests
    content: "Run `pnpm -r test` — ≥80 new tests pass (target counts: runtime-drivers ~80, mqtt-bridge ~50, tsdb-writer ~20, api ~30, web ~20)."
    status: pending
  - id: validation-gate-openspec
    content: "Run `openspec validate add-multi-broker-multi-ingest-and-identity-rewrite --strict` and resolve any issues."
    status: pending
---

# Plan: Multi-broker driver registry, multi-ingest paths, TSDB writer, topic-schema migration

## Background & Research

### Saved research

- `openspec/changes/add-multi-broker-multi-ingest-and-identity-rewrite/research-refs.md` — external + internal references
- `.slash/workspace/research/identity-rewrite-and-provisioning.md` — `device_key` as routing key rationale
- `.slash/workspace/research/device-type-registry-prior-art.md` — registry pattern reused for drivers

### CRITICAL PRECONDITION

**Specs 1 (add-plugin-device-type-registry), 2 (add-unregistered-device-lifecycle), 3 (extend-gateway-register-handshake) MUST be applied first.** Current Prisma schema (verified) has Gateway with `clientId`, `groupId`, `realUuid`-style fields but does **NOT** have a `Device` model or `Gateway.deviceKey`. The translator + tsdb-writer key off `deviceKey`. This plan assumes the prior three changes have materialized the Device table and added `Gateway.deviceKey` (string CUID alias). The first todo (`precondition-specs-1-2-3-applied`) gates everything else.

### Current `apps/mqtt-bridge` (will be refactored)

- `apps/mqtt-bridge/src/mqtt-manager.ts` lines 92–135 — single hardcoded message handler:

```ts
client.on('message', (topic, payload) => {
  let parsed: unknown;
  let parseError: string | undefined;
  if (topic.startsWith('modules/')) {
    try {
      const decoded = cborDecode(payload) as Record<string, unknown>;
      if (decoded && typeof decoded === 'object') {
        if (decoded['id'] instanceof Uint8Array) {
          decoded['id'] = Buffer.from(decoded['id']).toString('hex');
        }
      }
      parsed = decoded;
    } catch { /* JSON / base64 fallbacks */ }
  }
  const message = JSON.stringify({ nodeId: siteId, siteId, topic, payload: parsed, timestamp: new Date().toISOString(), ...(parseError ? { parseError } : {}) });
  sseFanout.emit(siteId, message);
  void writeMessage(siteId, topic, parsed);
});
```

- `apps/mqtt-bridge/src/broker-registry.ts` lines 11–70 — hardcoded `const mqttPort = 8883; const brokerUrl = 'mqtts://${host}:${mqttPort}';`
- `apps/mqtt-bridge/src/redis-writer.ts` lines 28–54 — key format today: `` const key = `${siteId}:${topic}`; ``; XADD with MAXLEN ~1000
- `apps/mqtt-bridge/src/sse-fanout.ts` lines 13–49 — EventEmitter, internal event name `msg:${siteId}`, max listeners 200, payload is a JSON string emitted by mqtt-manager (current shape: `{ nodeId, siteId, topic, payload, timestamp, parseError? }`)
- `apps/mqtt-bridge/src/server.ts` lines 56–95 — SSE stream `id: ${eventId}\ndata: ${message}\n\n`; supports Last-Event-ID replay via `readMessagesAfter(siteId, '#', lastEventId, 100)`
- `apps/mqtt-bridge/package.json` deps: `mqtt@^5.10.0`, `cbor-x@^1.5.9`, `ioredis@^5.4.1`, `hono@^4.6.0`, `jose@^5.9.0`
- **NO TEST FILES exist** in apps/mqtt-bridge today — every test in this plan must scaffold infrastructure (vitest config, mock broker like `aedes`, ioredis-mock).

### Current apply pipeline

- `packages/shared-types/src/apply.ts` lines 5–12:

```ts
export const OP_TYPES = ['createTenant', 'createSite', 'updateSite', 'issueCert', 'updateIngest', 'updateTsdb'] as const;
export const OpSchema = z.object({
  id: z.string(),
  type: z.enum(OP_TYPES),
  description: z.string(),
  path: z.string(),
  method: z.enum(['POST','PATCH','PUT']),
  body: z.unknown(),
  nodeId: z.string().optional(),
});
```

- `packages/api/src/lib/apply-planner.ts` lines 72–82 + 100–183 — `synthesizePlan` iterates nodes; broker-node loop emits createTenant→createSite→issueCert via `makeOp(type, description, path, method, body, nodeId?)` factory at lines 46–63. **New ops slot in after line 183 for `configureDriver`** (per broker node) and **after line 244 for `migrateTopicSchema`** (per SiteGroup).
- `packages/api/src/routers/apply.ts` lines 235–314 — dispatch loop calls `executeOp(op, instance, {tenantId, siteId})`. `executeOp` (in `apply-executor.ts`) treats every op as a daemon REST call. **For `configureDriver` + `migrateTopicSchema` we add pure-DB op handlers BEFORE the daemon-call branch** (dispatch by op.type).
- Audit pattern: `writeAudit(ctx.prisma, { orgId, userId, action, targetId, targetType, metadata })` (fire-and-forget); already used at apply.ts:341–355.

### Current Prisma (verified)

- `Site` model (schema.prisma:207–229): id, siteGroupId, canvasNodeId?, name, brokerKind?, ingestDirection?, throughputTier?, retentionPeriod?, controlaiTenantId?, controlaiSiteId?, mqttCert?, mqttKey?, tlsServername?. **No driverId/driverConfig/ingestModeJson today.**
- `SiteGroup` model (schema.prisma:188–203): id, projectId, name, createdAt, updatedAt. **No topicSchemaMode today.**
- `Gateway` model (schema.prisma:297–324): id, siteGroupId, label, kind, mode, endpointURL, tlsServername?, brokerHost?, brokerPort?, groupId, clientId, rootCaPemEnc, clientCertPemEnc, clientKeyPemEnc, sensors Json, jsonTopicTemplate?, desiredState, lastStatus, lastError?, lastProvisionedDeviceSerial?, lastProvisionedAt?. **clientId exists; deviceKey added by spec 2 — precondition.**
- `AuditLog` model (schema.prisma:233–249): id, orgId, userId?, action, targetId?, targetType?, metadata Json?, createdAt.
- Migrations directory layout: `packages/db/prisma/migrations/YYYYMMDDhhmmss_snake_case_description/migration.sql`.

### Current device-type registry pattern (to MIRROR for runtime-drivers)

- `packages/shared-types/src/node-types.ts` lines 5–14: NODE_TYPES enum
- Lines 18–69: per-type Zod schemas, all `z.object({ type: z.literal('...'), ... })`
- Lines 71–78: `z.discriminatedUnion('type', [SensorDataSchema, ...])`
- Lines 92–107: `defaultNodeData(type)` factory switch

**Runtime-drivers MUST mirror this**: `packages/runtime-drivers/src/schema.ts` exports `BrokerDriverSchema` (strict Zod), `packages/runtime-drivers/src/registry.ts` exports `registerBrokerDriver`/`getBrokerDriver`/`listBrokerDrivers`, `packages/runtime-drivers/drivers/<id>/index.ts` calls `registerBrokerDriver(...)` at import-time, `packages/runtime-drivers/drivers/index.ts` is the side-effect aggregator. `packages/runtime-drivers/package.json` follows shared-types' `tsup src/index.ts --format cjs,esm --dts` build.

### Current simulator (will be modified)

- `apps/simulator/src/cbor-codec.ts` lines 11–13: topic format template `modules/{groupId}/{msgType}/{clientId}`; encodeNbirth/Ndata/Ndeath at lines 19–78
- `apps/simulator/src/manager.ts` lines 156–210: publish loop; lines 179–206 dispatches CBOR (cbor-modules-cloud mode) vs JSON (jsonTopicTemplate)
- Switch logic stays mode-driven; topic-format choice now ALSO consults Site.driverId + SiteGroup.topicSchemaMode

### Current dashboard SSE (will be wrapped by adapter)

- `apps/web/hooks/use-site-stream.ts` lines 17–84: EventSource hook; current `TelemetryMessage` shape from shared-types/apply.ts:56–64 is `{ nodeId, siteId, topic?, payload?, status?, msgPerSec?, timestamp }`
- `apps/web/components/dashboard/widgets/sensor-io-stream.tsx` lines 217–312: inbound pane reads `data.topic` and `data.payload`; lines 260–268: topic filter matches `modules/{groupId}/` prefix
- `apps/web/components/canvas/apply-modal.tsx` lines 136–146 (confirm), 139–144 (op description map), 233–256 (OpList component) — extension points for new ops
- `apps/web/components/canvas/canvas.tsx` lines 324–338 (SSE status pill location) — insertion point for topicSchemaMode pill

### Design references (read while implementing)

- `openspec/changes/add-multi-broker-multi-ingest-and-identity-rewrite/design.md` §3 NormalizedMessage shape; §4 BrokerDriver registry; §5 topic translation (cache TTL 5 min, capacity 10k); §6 topicSchemaMode flag semantics; §7.1 sensor_data hypertable DDL; §7.2 consumer loop pseudocode; §9 dashboard adapter; §10 migration sequence; §11 observability.
- `openspec/changes/add-multi-broker-multi-ingest-and-identity-rewrite/specs/runtime-driver-registry/spec.md` — every Requirement + Scenario this plan implements.
- `openspec/changes/add-multi-broker-multi-ingest-and-identity-rewrite/migration-checklist.md` — operator runbook; informs docs-topic-schema-migration content.

## Testing Plan

(Strict TDD: every test todo precedes its implementation counterpart in execution order; see Delegation Notes for batches.)

- [ ] `precondition-specs-1-2-3-applied`: Verify Device + Gateway.deviceKey exist (read schema.prisma); if absent, halt and notify mad-agent that prior specs must apply first.
- [ ] `shared-types-apply-ops-tests`: tests in packages/shared-types/__tests__/apply.spec.ts asserting new op schemas
- [ ] `runtime-drivers-schema-tests`: schema accept/reject cases
- [ ] `runtime-drivers-normalized-message-tests`: NormalizedMessage validation
- [ ] `runtime-drivers-registry-tests`: register / get / list / duplicate id
- [ ] `runtime-drivers-topic-translator-tests`: legacy translation + cache behavior
- [ ] `runtime-drivers-driver-conformance-suite`: ~12 shared cases factory
- [ ] `mqtt-driver-tests`: conformance + golden CBOR fixture
- [ ] `kafka-driver-tests`: conformance + JSON mapper
- [ ] `http-webhook-driver-tests`: HMAC + replay protection
- [ ] `tsdb-direct-driver-tests`: conformance + idempotent writeDirect
- [ ] `tsdb-writer-consumer-tests`: 10k message throughput + idempotency
- [ ] `mqtt-bridge-redis-writer-tests`: dual-stack key writes
- [ ] `mqtt-bridge-sse-fanout-tests`: dual-stack event emission
- [ ] `mqtt-bridge-broker-registry-tests`: DriverConfigBundle for each driver
- [ ] `mqtt-bridge-http-ingest-tests`: POST /ingest/:siteId path
- [ ] `mqtt-bridge-orchestrator-tests`: end-to-end legacy/dual/new modes
- [ ] `simulator-tests`: outbound topic format per mode
- [ ] `apply-planner-tests`: new ops emitted in synthesized plan
- [ ] `apply-handlers-tests`: configureDriver + migrateTopicSchema persist + audit
- [ ] `gateway-update-tests`: cache invalidation hook
- [ ] `web-sse-adapter-tests`: legacy↔new shape adaptation
- [ ] `web-use-site-stream-tests`: hook pipes through adapter
- [ ] `web-canvas-pill-tests`: topic-schema pill rendering + admin gating

## Implementation Plan

(Each task id below mirrors a frontmatter `todos[].id`; ordered for delegation in Delegation Notes batches.)

- [ ] `precondition-specs-1-2-3-applied`
- [ ] `shared-types-apply-ops-impl`
- [ ] `prisma-schema-site-driver-config`
- [ ] `prisma-migration-add-site-driver-config`
- [ ] `runtime-drivers-package-scaffold`
- [ ] `runtime-drivers-schema-impl`
- [ ] `runtime-drivers-normalized-message-impl`
- [ ] `runtime-drivers-registry-impl`
- [ ] `runtime-drivers-topic-translator-impl`
- [ ] `mqtt-driver-impl`
- [ ] `kafka-driver-impl`
- [ ] `http-webhook-driver-impl`
- [ ] `tsdb-direct-driver-impl`
- [ ] `drivers-aggregator-impl`
- [ ] `tsdb-writer-package-scaffold`
- [ ] `tsdb-writer-hypertable-migration`
- [ ] `tsdb-writer-pg-helper-impl`
- [ ] `tsdb-writer-consumer-impl`
- [ ] `tsdb-writer-server-impl`
- [ ] `tsdb-writer-deploy-config`
- [ ] `mqtt-bridge-orchestrator-impl`
- [ ] `mqtt-bridge-ingress-translator-impl`
- [ ] `mqtt-bridge-redis-writer-dualstack-impl`
- [ ] `mqtt-bridge-sse-fanout-dualstack-impl`
- [ ] `mqtt-bridge-broker-registry-update-impl`
- [ ] `mqtt-bridge-http-ingest-route-impl`
- [ ] `mqtt-bridge-mqtt-manager-deprecate`
- [ ] `simulator-outbound-topic-switch-impl`
- [ ] `apply-planner-new-ops-impl`
- [ ] `apply-handlers-configure-driver-impl`
- [ ] `apply-handlers-migrate-topic-schema-impl`
- [ ] `gateway-update-cache-invalidate-impl`
- [ ] `web-sse-adapter-impl`
- [ ] `web-use-site-stream-adapter-impl`
- [ ] `web-widget-consumer-migration`
- [ ] `web-apply-modal-new-ops-impl`
- [ ] `web-canvas-topic-schema-pill-impl`
- [ ] `docs-driver-authoring`
- [ ] `docs-topic-schema-migration`
- [ ] `docs-readmes`
- [ ] `deprecation-markers`
- [ ] `validation-gate-typecheck`
- [ ] `validation-gate-tests`
- [ ] `validation-gate-openspec`

## Delegation Notes

**Strict file boundaries**: no two coder agents share an implementation file. Tests for a given module live with that module's coder unless explicitly noted.

### Batch 0 — Precondition (single coder, sequential)
- [ ] **Coder PRE**: `precondition-specs-1-2-3-applied` → READ-ONLY check of `packages/db/prisma/schema.prisma` for Device model + Gateway.deviceKey. If missing, HALT and emit a status report — mad-agent must apply specs 1–3 first.

### Batch 1 — Foundation (parallel after Batch 0 passes)

- [ ] **Coder 1A — Shared types**:
  - `shared-types-apply-ops-tests`, `shared-types-apply-ops-impl`
  - Files: `packages/shared-types/src/apply.ts`, `packages/shared-types/__tests__/apply.spec.ts`

- [ ] **Coder 1B — Prisma schema + migration**:
  - `prisma-schema-site-driver-config`, `prisma-migration-add-site-driver-config`
  - Files: `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/<new>/migration.sql`

- [ ] **Coder 1C — runtime-drivers package scaffolding + core schema/registry/normalized-message**:
  - `runtime-drivers-package-scaffold`, `runtime-drivers-schema-impl`, `runtime-drivers-schema-tests`, `runtime-drivers-normalized-message-impl`, `runtime-drivers-normalized-message-tests`, `runtime-drivers-registry-impl`, `runtime-drivers-registry-tests`, `runtime-drivers-driver-conformance-suite`
  - Files: `packages/runtime-drivers/package.json`, `packages/runtime-drivers/tsconfig.json`, `packages/runtime-drivers/src/index.ts`, `packages/runtime-drivers/src/schema.ts`, `packages/runtime-drivers/src/normalized-message.ts`, `packages/runtime-drivers/src/registry.ts`, `packages/runtime-drivers/src/__tests__/{schema,normalized-message,registry,driver-conformance-suite}.spec.ts` (+ suite factory file `driver-conformance-suite.ts`)
  - Mirror `packages/shared-types/src/node-types.ts` pattern exactly.

### Batch 2 — Topic translator + 4 drivers (parallel after Batch 1)

(Each driver lives in its own folder with no shared files.)

- [ ] **Coder 2A — Topic translator**:
  - `runtime-drivers-topic-translator-impl`, `runtime-drivers-topic-translator-tests`
  - Files: `packages/runtime-drivers/src/topic-translator.ts`, `packages/runtime-drivers/src/__tests__/topic-translator.spec.ts`
  - Imports Prisma client from `@controlai-web/db`; LRU from `lru-cache` package (add dep).

- [ ] **Coder 2B — mqtt-driver**:
  - `mqtt-driver-impl`, `mqtt-driver-tests`
  - Files: `packages/runtime-drivers/drivers/mqtt-driver/{index.ts, config-schema.ts, instance.ts}`, `packages/runtime-drivers/drivers/mqtt-driver/__tests__/*.spec.ts`, `packages/runtime-drivers/drivers/mqtt-driver/__tests__/fixtures/nbirth-golden.cbor`

- [ ] **Coder 2C — kafka-driver**:
  - `kafka-driver-impl`, `kafka-driver-tests`
  - Files: `packages/runtime-drivers/drivers/kafka-driver/{index.ts, config-schema.ts, instance.ts}`, `packages/runtime-drivers/drivers/kafka-driver/__tests__/*.spec.ts`
  - Add `kafkajs` dep to runtime-drivers package.json.

- [ ] **Coder 2D — http-webhook-driver**:
  - `http-webhook-driver-impl`, `http-webhook-driver-tests`
  - Files: `packages/runtime-drivers/drivers/http-webhook-driver/{index.ts, config-schema.ts, instance.ts}`, `packages/runtime-drivers/drivers/http-webhook-driver/__tests__/*.spec.ts`

- [ ] **Coder 2E — tsdb-direct-driver**:
  - `tsdb-direct-driver-impl`, `tsdb-direct-driver-tests`
  - Files: `packages/runtime-drivers/drivers/tsdb-direct-driver/{index.ts, config-schema.ts, instance.ts}`, `packages/runtime-drivers/drivers/tsdb-direct-driver/__tests__/*.spec.ts`

### Batch 3 — Aggregator (sequential — single coder, depends on Batch 2)

- [ ] **Coder 3A — Drivers aggregator**:
  - `drivers-aggregator-impl`
  - Files: `packages/runtime-drivers/drivers/index.ts`, finalize `packages/runtime-drivers/src/index.ts` re-exports.
  - Verify `getBrokerDriver('mqtt-driver' | 'kafka-driver' | 'http-webhook-driver' | 'tsdb-direct-driver')` resolves at import time.

### Batch 4 — Services (parallel after Batch 3)

- [ ] **Coder 4A — apps/tsdb-writer**:
  - `tsdb-writer-package-scaffold`, `tsdb-writer-hypertable-migration`, `tsdb-writer-pg-helper-impl`, `tsdb-writer-consumer-impl`, `tsdb-writer-server-impl`, `tsdb-writer-consumer-tests`, `tsdb-writer-deploy-config`
  - Files: `apps/tsdb-writer/**` (new package — package.json, tsconfig.json, Dockerfile, .env.example, README.md, src/{index,server,consumer,pg}.ts, src/migrations/001-initial.sql, src/__tests__/consumer.spec.ts, deploy/tsdb-writer/)

- [ ] **Coder 4B — apps/mqtt-bridge orchestrator + new modules**:
  - `mqtt-bridge-orchestrator-impl`, `mqtt-bridge-ingress-translator-impl`, `mqtt-bridge-orchestrator-tests`
  - Files: `apps/mqtt-bridge/src/orchestrator.ts`, `apps/mqtt-bridge/src/ingress-translator.ts`, `apps/mqtt-bridge/__tests__/orchestrator.spec.ts` (set up vitest infra), `apps/mqtt-bridge/vitest.config.ts`

- [ ] **Coder 4C — apps/mqtt-bridge redis-writer + sse-fanout + broker-registry + http ingest route + mqtt-manager deprecation**:
  - `mqtt-bridge-redis-writer-dualstack-impl`, `mqtt-bridge-redis-writer-tests`, `mqtt-bridge-sse-fanout-dualstack-impl`, `mqtt-bridge-sse-fanout-tests`, `mqtt-bridge-broker-registry-update-impl`, `mqtt-bridge-broker-registry-tests`, `mqtt-bridge-http-ingest-route-impl`, `mqtt-bridge-http-ingest-tests`, `mqtt-bridge-mqtt-manager-deprecate`
  - Files: `apps/mqtt-bridge/src/redis-writer.ts`, `apps/mqtt-bridge/src/sse-fanout.ts`, `apps/mqtt-bridge/src/broker-registry.ts`, `apps/mqtt-bridge/src/server.ts`, `apps/mqtt-bridge/src/mqtt-manager.ts`, `apps/mqtt-bridge/__tests__/{redis-writer,sse-fanout,broker-registry,server}.spec.ts`
  - **Coordinate with Coder 4B** on `vitest.config.ts` ownership — 4B creates it, 4C extends test list. **Coder 4C does NOT touch orchestrator.ts or ingress-translator.ts.**

- [ ] **Coder 4D — apps/simulator outbound switch**:
  - `simulator-outbound-topic-switch-impl`, `simulator-tests`
  - Files: `apps/simulator/src/manager.ts`, `apps/simulator/src/__tests__/manager.spec.ts` (set up if absent)

### Batch 5 — Apply pipeline + gateway hook (parallel after Batch 4)

- [ ] **Coder 5A — apply-planner**:
  - `apply-planner-new-ops-impl`, `apply-planner-tests`
  - Files: `packages/api/src/lib/apply-planner.ts`, `packages/api/src/lib/__tests__/apply-planner.spec.ts`

- [ ] **Coder 5B — apply router handlers**:
  - `apply-handlers-configure-driver-impl`, `apply-handlers-migrate-topic-schema-impl`, `apply-handlers-tests`
  - Files: `packages/api/src/routers/apply.ts`, `packages/api/src/routers/__tests__/apply.spec.ts`

- [ ] **Coder 5C — gateway.update cache invalidation**:
  - `gateway-update-cache-invalidate-impl`, `gateway-update-tests`
  - Files: `packages/api/src/routers/gateway.ts`, `packages/api/src/routers/__tests__/gateway.spec.ts`
  - Imports cache invalidation function from `@controlai-web/runtime-drivers/topic-translator`.

### Batch 6 — Web layer (parallel after Batch 5)

- [ ] **Coder 6A — SSE adapter + use-site-stream hook**:
  - `web-sse-adapter-impl`, `web-sse-adapter-tests`, `web-use-site-stream-adapter-impl`, `web-use-site-stream-tests`
  - Files: `apps/web/lib/dashboard/sse-adapter.ts`, `apps/web/lib/dashboard/__tests__/sse-adapter.spec.ts`, `apps/web/hooks/use-site-stream.ts`, `apps/web/hooks/__tests__/use-site-stream.spec.ts`

- [ ] **Coder 6B — Dashboard widget consumer migration**:
  - `web-widget-consumer-migration`
  - Files: `apps/web/components/dashboard/widgets/sensor-io-stream.tsx`, `apps/web/components/dashboard/widgets/last-n-messages.tsx`, `apps/web/components/dashboard/widgets/status-board.tsx`
  - Consumes NormalizedMessage from adapter (depends on Coder 6A's adapter contract).

- [ ] **Coder 6C — Apply modal + canvas toolbar pill**:
  - `web-apply-modal-new-ops-impl`, `web-canvas-topic-schema-pill-impl`, `web-canvas-pill-tests`
  - Files: `apps/web/components/canvas/apply-modal.tsx`, `apps/web/components/canvas/canvas.tsx`, `apps/web/components/canvas/__tests__/topic-schema-pill.spec.tsx`

### Batch 7 — Docs + deprecation markers (parallel after Batch 6)

- [ ] **Coder 7A — Docs**:
  - `docs-driver-authoring`, `docs-topic-schema-migration`, `docs-readmes`
  - Files: `docs/driver-authoring.md`, `docs/topic-schema-migration.md`, `apps/mqtt-bridge/README.md`, `apps/tsdb-writer/README.md`

- [ ] **Coder 7B — Deprecation markers**:
  - `deprecation-markers`
  - Files (small annotations only — coordinate timing): `apps/mqtt-bridge/src/redis-writer.ts`, `apps/mqtt-bridge/src/sse-fanout.ts`, `apps/mqtt-bridge/src/mqtt-manager.ts`
  - **Conflict warning**: Coder 4C owns these files in Batch 4. Coder 7B runs strictly AFTER Batch 4 lands and merges; mad-agent must serialize.

### Batch 8 — Validation gate (sequential, single coder)

- [ ] **Coder 8 — Validation**:
  - `validation-gate-typecheck`, `validation-gate-tests`, `validation-gate-openspec`
  - Commands: `pnpm -r typecheck`, `pnpm -r test`, `openspec validate add-multi-broker-multi-ingest-and-identity-rewrite --strict`. Any failures → return ownership to the relevant Batch coder.

### Dependencies

```
Batch 0 (precondition) → 1 (foundation) → 2 (translator + 4 drivers) → 3 (aggregator) → 4 (services) → 5 (apply) → 6 (web) → 7 (docs + deprecation) → 8 (validation)
```

- Batch 1 parallelism is independent (A/B/C touch disjoint packages).
- Batch 2 requires Batch 1C's schema/registry; all five sub-coders parallel.
- Batch 3 is a synchronization point — single coder verifies all 4 drivers register.
- Batch 4 splits mqtt-bridge work between 4B (orchestrator+ingress) and 4C (existing modules + http route + deprecation) under strict file ownership; vitest config owned by 4B.
- Batch 5 depends on Batch 4 because apply-handlers import from runtime-drivers (`getBrokerDriver`, `topicTranslatorCache`).
- Batch 6A→6B contract (adapter→widgets).
- Batch 7B serializes with Batch 4C's file edits.

### Risk Areas

1. **Spec 1/2/3 precondition** — without Device + Gateway.deviceKey the translator + tsdb-writer cannot route. Batch 0 must HALT execution if absent.
2. **vitest config ownership in apps/mqtt-bridge** — 4B creates `vitest.config.ts`; 4C must not overwrite. Resolve by 4B publishing config first, 4C extending test glob via convention rather than file edit.
3. **runtime-drivers package as workspace dep** — apps/mqtt-bridge, apps/tsdb-writer, apps/simulator, packages/api ALL add `@controlai-web/runtime-drivers` to package.json. Coder 1C must `pnpm install` after publishing the package so workspace links resolve.
4. **LRU cache module choice** — use `lru-cache@^11` (no deps, well-maintained). Coder 2A adds to runtime-drivers/package.json.
5. **Prisma client import in runtime-drivers/topic-translator** — runtime-drivers becomes a non-pure package because it imports `@controlai-web/db`. Acceptable tradeoff documented in design §5.1. Coder 2A adds `@controlai-web/db` workspace dep.
6. **TimescaleDB testcontainers in CI** — Coder 4A must add `testcontainers` devDep and document `DOCKER` requirement in tsdb-writer README; CI runner needs Docker socket.
7. **DAEJAK clientId regex** — apply-handlers-migrate-topic-schema-impl uses `/^[0-9A-F]{24}$/` to detect DAEJAK gateways. Document in code that this regex is intentionally narrow and may evolve as new DAEJAK SKUs ship.
8. **kafkajs and mqtt brokers in tests** — using `aedes` (in-process MQTT broker) for mqtt-driver tests + `kafkajs` test fixtures with `KAFKAJS_NO_PARTITIONER_WARNING=1`. Coder 2B/2C add devDeps.
9. **Backward compat in dual-stack window** — Coder 6B's widget migration MUST preserve rendering when SSE adapter returns null (defensive fallback). E2E behavior tested as part of `web-sse-adapter-tests`.
10. **Outbound HTTP ingest route conflicts with Hono app** — Coder 4C verifies new `POST /ingest/:siteId` route does not collide with existing `/health` or `/sites/:siteId/stream`.

## Done Criteria

- [ ] All `todos` in frontmatter are `status: done` and matching body checklists are `[x]`.
- [ ] `pnpm -r typecheck` clean.
- [ ] `pnpm -r test` clean — ≥80 net new tests pass.
- [ ] `openspec validate add-multi-broker-multi-ingest-and-identity-rewrite --strict` clean.
- [ ] Every Requirement scenario in `openspec/changes/add-multi-broker-multi-ingest-and-identity-rewrite/specs/runtime-driver-registry/spec.md` has at least one passing test (cross-reference at validation gate).
- [ ] OpenSpec `tasks.md` (167 lines, 15 sections) — every `- [ ]` flipped to `- [x]` except section 14.4 (explicitly deferred follow-up) and section 15.4–15.7 (staging steps NOT executed by this plan; flagged as deploy work).
- [ ] Spec 1–3 precondition verified at Batch 0 (Device model + Gateway.deviceKey present).
- [ ] No application code edited outside the file allowlists in Delegation Notes.
- [ ] Deprecated paths (legacy Redis key, legacy SSE shape, mqtt-manager shim, hardcoded 8883) marked `@deprecated` with follow-up ticket reference; removal explicitly NOT in scope.

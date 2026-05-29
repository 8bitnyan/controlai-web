# Tasks: add-multi-broker-multi-ingest-and-identity-rewrite

Depends on specs 1, 2, 3 being applied. This is the largest of the four changes.

## 1. Shared types + apply ops

- [ ] 1.1 Extend `packages/shared-types/src/apply.ts` adding op types `configureDriver` and `migrateTopicSchema` to `OP_TYPES` enum + Zod discriminated union. ~50 LOC delta.
- [ ] 1.2 Add `BrokerDriverIdSchema = z.string().regex(...)` and `TopicSchemaModeSchema = z.enum(['legacy', 'dual', 'new'])`. ~10 LOC.
- [ ] 1.3 Update existing apply Zod tests in `packages/shared-types/__tests__/apply.spec.ts`. ~30 LOC.

## 2. Prisma schema + migrations

- [ ] 2.1 Edit `packages/db/prisma/schema.prisma`:
  - Add `driverId String? @default("mqtt-driver")` on Site.
  - Add `driverConfig Json?` on Site.
  - Add `ingestModeJson Json?` on Site.
  - Add `topicSchemaMode String @default("legacy")` on SiteGroup.
  - ~25 LOC delta.
- [ ] 2.2 Generate Prisma migration `pnpm --filter @controlai-web/db prisma migrate dev --name add-site-driver-config`. Commit.
- [ ] 2.3 Create `apps/tsdb-writer/src/migrations/001-initial.sql` with the `sensor_data` hypertable DDL + indices per design §7.1. ~60 LOC.
- [ ] 2.4 Wire `node-pg-migrate` (or equivalent — see existing deps) for tsdb-writer migration management. Add `pnpm --filter @controlai-web/tsdb-writer migrate` script.

## 3. packages/runtime-drivers — schema + registry

- [ ] 3.1 Create `packages/runtime-drivers/package.json` (workspace package).
- [ ] 3.2 Create `packages/runtime-drivers/src/schema.ts` exporting `BrokerDriverSchema`, `NormalizedMessageSchema`, types. ~120 LOC.
- [ ] 3.3 Create `packages/runtime-drivers/src/registry.ts` exporting `registerBrokerDriver`, `getBrokerDriver`, `listBrokerDrivers`, with the same duplicate-id detection pattern as spec 1. ~120 LOC.
- [ ] 3.4 Create `packages/runtime-drivers/src/normalized-message.ts`. ~30 LOC.
- [ ] 3.5 Create `packages/runtime-drivers/src/topic-translator.ts` per design §5. ~140 LOC including LRU cache wiring.
- [ ] 3.6 Create `packages/runtime-drivers/src/__tests__/schema.spec.ts`, `registry.spec.ts`, `topic-translator.spec.ts`. ~280 LOC total, ≥ 30 cases.
- [ ] 3.7 Create `packages/runtime-drivers/src/__tests__/driver-conformance-suite.ts`: a factory that returns a shared suite of cases each driver runs against a mock connection. ~140 LOC.

## 4. mqtt-driver

- [ ] 4.1 Create `packages/runtime-drivers/drivers/mqtt-driver/` package-internal module:
  - `index.ts` calling `registerBrokerDriver(...)` at import.
  - `config-schema.ts` — Zod: `{ host, port, tls: { ca, cert, key }?, clientIdPrefix?, qos: 0|1|2 }`.
  - `instance.ts` — Implements `BrokerDriverInstance`. Subscribes per the current `topicSchemaMode`. Decodes CBOR for legacy `modules/` topics; passes JSON for new. Outbound publishes via the new-format topic when invoked from simulator.
  - ~280 LOC across files.
- [ ] 4.2 Tests `packages/runtime-drivers/drivers/mqtt-driver/__tests__/`:
  - Conformance suite runs green.
  - Subscribe in `legacy` mode → only modules/# subscription.
  - Subscribe in `dual` mode → both subscriptions.
  - Decode CBOR for a legacy NBIRTH payload from the golden simulator fixture.
  - ~200 LOC.

## 5. kafka-driver

- [ ] 5.1 Create `packages/runtime-drivers/drivers/kafka-driver/` similarly:
  - `config-schema.ts` — `{ brokers[], saslMechanism?, saslUsername?, saslPassword?, groupId, topics[], jsonMapper: { deviceKeyPath, dataTypePath, payloadPath, tsPath? } }`.
  - `instance.ts` — wraps `kafkajs` consumer; subscribes per config.topics; for each message, runs `jsonMapper` to construct `NormalizedMessage`; publishes are NOT supported in v1 (throws on `publish`).
  - ~240 LOC.
- [ ] 5.2 Add `kafkajs` dep to the runtime-drivers package (or alternately to apps/mqtt-bridge if shared).
- [ ] 5.3 Tests: conformance suite (publish skip), JSON mapping correctness, missing-deviceKey message → emit with `deviceKey: null` and a structured warning log. ~180 LOC.

## 6. http-webhook-driver

- [ ] 6.1 Create `packages/runtime-drivers/drivers/http-webhook-driver/`:
  - `config-schema.ts` — `{ secret, jsonMapper, requireHmac: boolean }`.
  - `instance.ts` — does NOT open a network listener itself; instead exposes a request handler that mqtt-bridge mounts at `POST /ingest/:siteId`. Validates HMAC, parses JSON, emits NormalizedMessage.
  - ~180 LOC.
- [ ] 6.2 Wire the handler into `apps/mqtt-bridge/src/orchestrator.ts` (task 7.3) — mqtt-bridge becomes the HTTP gateway for webhook ingest as well.
- [ ] 6.3 Tests: HMAC validation, mapping, replay protection (timestamp ≤ 5 min skew). ~160 LOC.

## 7. apps/mqtt-bridge orchestrator refactor

- [ ] 7.1 Create `apps/mqtt-bridge/src/orchestrator.ts`:
  - For each managed Site, resolve `getBrokerDriver(driverId)` and instantiate via the driver's factory.
  - Hook the driver's emitted NormalizedMessage stream into: Redis-writer, SSE-fanout, optional TSDB-direct write.
  - Honor `SiteGroup.topicSchemaMode` (poll every 30s via Prisma).
  - ~360 LOC.
- [ ] 7.2 Delete (or significantly cut down) `src/mqtt-manager.ts`; its remaining logic moves into `mqtt-driver`. Keep file as a deprecated shim re-exporting from the new orchestrator until task 14.4 cleanup.
- [ ] 7.3 Add HTTP `POST /ingest/:siteId` route in `src/server.ts` delegating to the per-Site http-webhook-driver instance.
- [ ] 7.4 Modify `src/redis-writer.ts`:
  - Key format: `{siteId}:{deviceKey}:{dataType}` for the new shape.
  - In `dual` mode, write BOTH key formats.
  - In `legacy` mode, write only legacy key format.
  - In `new` mode, write only new key format.
  - ~80 LOC delta + tests.
- [ ] 7.5 Modify `src/sse-fanout.ts`:
  - Emit `NormalizedMessage` shape on `data:` field.
  - In `dual` mode, ALSO emit legacy shape `{ topic, payload, ts }` as a parallel event with `event: legacy`. (Keeps existing widgets working through the migration.)
  - ~80 LOC delta + tests.
- [ ] 7.6 Modify `src/broker-registry.ts` (existing) to load `Site.driverId` + `Site.driverConfig` instead of hardcoded MQTT options.
- [ ] 7.7 Modify `src/mqtt-manager.ts` (after extraction) to delete the hardcoded port 8883.

## 8. apps/tsdb-writer

- [ ] 8.1 Create `apps/tsdb-writer/package.json`, `tsconfig.json`, `Dockerfile`.
- [ ] 8.2 Create `apps/tsdb-writer/src/index.ts`:
  - HTTP server on `TSDB_WRITER_PORT` (default 4002) for `/health` + `/metrics` (prom-client).
  - Spawn consumer per design §7.2.
  - ~120 LOC.
- [ ] 8.3 Create `apps/tsdb-writer/src/consumer.ts`:
  - Redis Streams consumer-group `tsdb-writer` per Site stream.
  - Batches of ≤ 500 messages.
  - Idempotent `INSERT ... ON CONFLICT DO NOTHING`.
  - Throttled `Device.lastSeenAt` write per design.
  - ~280 LOC.
- [ ] 8.4 Create `apps/tsdb-writer/src/pg.ts` — pg pool + batchInsert helper. ~80 LOC.
- [ ] 8.5 Create `apps/tsdb-writer/src/__tests__/consumer.spec.ts`:
  - Testcontainers TimescaleDB image; publish 10,000 messages over 5s; assert all visible in `sensor_data`.
  - Re-publish the same batch; assert zero duplicate rows (idempotency).
  - Continuous aggregate refresh test (1m rollup).
  - ~320 LOC.
- [ ] 8.6 Add deploy config: `deploy/tsdb-writer/` mirror of existing `deploy/mqtt-bridge/`.

## 9. apps/simulator outbound topic switch

- [ ] 9.1 Modify `apps/simulator/src/manager.ts`:
  - When publishing, look up the Site's `driverId`. If `mqtt-driver`, use `formatNewTopic({ siteId, deviceKey, dataType })`. Else use the driver-specific outbound path (Kafka producer not v1 → throw if simulator targets a Site whose driverId is non-mqtt for outbound).
  - Encode payload as JSON for the new topic schema; keep CBOR encoding ONLY when the SiteGroup's topicSchemaMode is `legacy` AND the Site explicitly opts into CBOR via driverConfig (DAEJAK parity test fixture).
  - ~140 LOC delta.
- [ ] 9.2 Update existing simulator tests to cover the new topic format. ~80 LOC.

## 10. apply-planner + apply.ts handlers

- [ ] 10.1 Modify `packages/api/src/lib/apply-planner.ts`:
  - For each broker node, after the existing createSite/issueCert ops, emit `configureDriver({ siteId, driverId: <from Site or default>, driverConfig: <derived from node.data.config> })`.
  - For each SiteGroup whose `topicSchemaMode !== 'legacy'` AND the user explicitly toggles via a new canvas-toolbar action, emit `migrateTopicSchema`.
  - ~120 LOC delta.
- [ ] 10.2 Modify `packages/api/src/routers/apply.ts`:
  - Add op handlers for `configureDriver` (validates via driver, UPDATE Site, audit) and `migrateTopicSchema` (UPDATE SiteGroup.topicSchemaMode, audit).
  - ~140 LOC delta.
- [ ] 10.3 Tests for both ops in `apply.spec.ts`. ~120 LOC.

## 11. Dashboard SSE adapter

- [ ] 11.1 Create `apps/web/lib/dashboard/sse-adapter.ts` per design §9. ~80 LOC.
- [ ] 11.2 Modify `apps/web/hooks/use-site-stream.ts` to pipe events through the adapter; widget consumers see only `NormalizedMessage`. ~40 LOC delta.
- [ ] 11.3 Tests verifying both legacy and new shape inputs normalize. ~120 LOC.

## 12. Apply UX

- [ ] 12.1 Modify `apps/web/components/canvas/apply-modal.tsx`:
  - Show new ops in the plan: `configureDriver`, `migrateTopicSchema`.
  - For `migrateTopicSchema`, show a "Topic schema: legacy → dual" pill.
  - ~60 LOC delta.
- [ ] 12.2 Modify `apps/web/components/canvas/canvas.tsx` (toolbar):
  - Display the current SiteGroup's `topicSchemaMode` as a small read-only pill.
  - Admin role gets a "Migrate schema…" menu opening a confirmation dialog that emits the apply op. (Ops affordance only; not for general users.)
  - ~80 LOC delta.

## 13. Documentation

- [ ] 13.1 Create `openspec/changes/add-multi-broker-multi-ingest-and-identity-rewrite/research-refs.md`.
- [ ] 13.2 Create `openspec/changes/add-multi-broker-multi-ingest-and-identity-rewrite/migration-checklist.md` (long runbook, see template).
- [ ] 13.3 Create `docs/driver-authoring.md` — how to add a new BrokerDriver. Mirrors spec 1's manifest-authoring doc.
- [ ] 13.4 Create `docs/topic-schema-migration.md` — operator-facing per-SiteGroup migration guide.
- [ ] 13.5 Update `apps/mqtt-bridge/README.md` and `apps/tsdb-writer/README.md`.

## 14. Cleanup + deprecation

- [ ] 14.1 Mark legacy `{ siteId, topic }` Redis key format as deprecated in `redis-writer.ts` with a follow-up ticket reference.
- [ ] 14.2 Mark legacy SSE `event: legacy` shape as deprecated.
- [ ] 14.3 Mark `mqtt-manager.ts` as deprecated shim with a follow-up ticket.
- [ ] 14.4 (Follow-up change, NOT this one): drop legacy formats once all live SiteGroups are off `topicSchemaMode = legacy` for non-DAEJAK SiteGroups. DAEJAK SiteGroups stay on `dual` indefinitely; the legacy formats stay alive for them inside the translator.

## 15. Validation gate

- [ ] 15.1 `pnpm -r typecheck` clean.
- [ ] 15.2 `pnpm -r test` clean (≥ 80 new tests across spec).
- [ ] 15.3 `openspec validate add-multi-broker-multi-ingest-and-identity-rewrite --strict` clean.
- [ ] 15.4 Staging: deploy with a SiteGroup in `legacy`; verify everything still works.
- [ ] 15.5 Staging: flip the SiteGroup to `dual`; verify simulator publishes on new schema AND mqtt-driver translates legacy; verify tsdb-writer ingests; verify dashboards keep rendering.
- [ ] 15.6 Staging: flip a non-DAEJAK SiteGroup to `new`; verify mqtt-driver drops the legacy subscription; verify dashboards survive.
- [ ] 15.7 Run a 5-minute load test on tsdb-writer: 50k msg/s sustained; assert p95 latency ≤ 200ms publish→TSDB.

# Migration checklist — add-multi-broker-multi-ingest-and-identity-rewrite

This change introduces new infrastructure (apps/tsdb-writer, hypertable, driver registry) and a per-SiteGroup topic-schema migration with a one-minor-release window. Plan and execute carefully.

## Pre-deploy

- [ ] **Verify specs 1, 2, 3 are fully applied in production** (registry live, Device rows materialized, register handshake available). Without spec 2, the `Gateway.clientId → deviceKey` translation has no target.
- [ ] **Provision TimescaleDB instance** (managed service or self-hosted). Capture the connection string into `TSDB_WRITER_PG_URL` env var. Validate `CREATE EXTENSION IF NOT EXISTS timescaledb;` runs cleanly.
- [ ] **Run `apps/tsdb-writer` migrations against the new TSDB**: `pnpm --filter @controlai-web/tsdb-writer migrate up`. Verify `sensor_data` hypertable created (`SELECT * FROM timescaledb_information.hypertables;`).
- [ ] **Provision Kafka broker (optional, only if any Site will use kafka-driver)**: confirm SASL credentials, capture in driverConfig.
- [ ] **Set deploy-time env flags**:
  - `TSDB_WRITER_PG_URL`
  - `ENABLE_TSDB_WRITER=true` (mqtt-bridge + tsdb-writer both gate on this initially)
  - `MQTT_BRIDGE_DRIVER_REGISTRY=enabled`
  - `DEFAULT_TOPIC_SCHEMA_MODE=legacy` (existing SiteGroups stay legacy; new SiteGroups default to dual via apply-planner)
- [ ] **Verify the driver-conformance suite passes in CI** against all v1 drivers.
- [ ] **Take a Postgres snapshot** (Site + SiteGroup + Device + Gateway). Migration introduces new columns with defaults — safe — but snapshot is cheap insurance.
- [ ] **Identify the DAEJAK SiteGroup count**: `SELECT COUNT(DISTINCT siteGroupId) FROM "Device" WHERE "realUuid" ~ '^[0-9A-F]{24}$';` — record. These SiteGroups STAY ON `dual` indefinitely.

## Deploy phase 1: infrastructure (no traffic change yet)

- [ ] Deploy `apps/tsdb-writer` to production with `ENABLE_TSDB_WRITER=false`. Verify health probes green; verify it does NOT consume anything yet.
- [ ] Apply the Prisma migration `add-site-driver-config`. Verify Site rows now have `driverId = 'mqtt-driver'` defaults and `topicSchemaMode = 'legacy'` on SiteGroups.
- [ ] Deploy refactored `apps/mqtt-bridge` with `MQTT_BRIDGE_DRIVER_REGISTRY=enabled` but `topicSchemaMode = 'legacy'` across the board. **At this point behavior MUST be identical to pre-deploy** — same MQTT subscription, same Redis key format, same SSE shape.
- [ ] Smoke-test: open 3 dashboards, verify data flows; restart simulator, verify reconnects; tail logs for errors. Tail `bridge_messages_total` Prometheus counter; verify steady-state matches pre-deploy.
- [ ] Enable tsdb-writer: set `ENABLE_TSDB_WRITER=true` and restart. With all SiteGroups still on `legacy`, tsdb-writer should see EMPTY new-format streams. Verify `writer_inserts_total = 0` and consumer-lag = 0.

## Deploy phase 2: per-SiteGroup migration to `dual`

For EACH SiteGroup (start with low-traffic ones, then DAEJAK SiteGroups, then non-DAEJAK):

- [ ] Apply `migrateTopicSchema({ siteGroupId, mode: 'dual' })` via the apply pipeline (or directly via tRPC for ops).
- [ ] Within 60s, verify mqtt-bridge logs show `Subscribing to controlai/<siteId>/#` for the SiteGroup's Sites.
- [ ] Within 60s, verify redis-writer is writing BOTH key formats (`{siteId}:{topic}` AND `{siteId}:{deviceKey}:{dataType}`) by spot-checking 3 streams via `redis-cli XLEN ...`.
- [ ] Verify the simulator (if any device is being simulated in this SiteGroup) publishes on the NEW topic format. Spot-check via `mosquitto_sub -t 'controlai/#'`.
- [ ] Verify tsdb-writer starts ingesting for this SiteGroup. `writer_inserts_total{siteId=<X>}` SHALL increment.
- [ ] Verify SSE consumers (dashboards) keep rendering. The adapter normalizes both shapes.
- [ ] Tail `bridge_translation_latency_ms` p95. Expected ≤ 5ms after cache warm-up.
- [ ] **Wait at least 24 hours** monitoring before migrating the next SiteGroup. Watch for: consumer lag growing in tsdb-writer, dashboard widgets going dark, Prisma cache invalidation race conditions.

## Deploy phase 3: per-SiteGroup migration to `new` (NON-DAEJAK ONLY)

For each non-DAEJAK SiteGroup:

- [ ] Apply `migrateTopicSchema({ siteGroupId, mode: 'new' })`.
- [ ] Verify the apply op succeeded (the op refuses for DAEJAK SiteGroups; this MUST be a no-op error for those).
- [ ] Within 60s, verify mqtt-bridge UNSUBSCRIBES from `modules/<...>` for that SiteGroup's Sites.
- [ ] Within 60s, verify redis-writer stops writing legacy key format. Spot-check via `redis-cli XLEN {siteId}:modules/...` — should freeze.
- [ ] Verify dashboards continue rendering. The adapter handles the new-only shape.
- [ ] Verify tsdb-writer keeps ingesting.

## Deploy phase 4: cleanup (next minor release, NOT part of this change)

- [ ] Remove the legacy Redis key format writes from `redis-writer.ts`.
- [ ] Remove the legacy `event: legacy` SSE event from `sse-fanout.ts`.
- [ ] Remove the SSE adapter `apps/web/lib/dashboard/sse-adapter.ts` (no more legacy shape to translate).
- [ ] **DO NOT** remove `translateLegacyTopic` — DAEJAK SiteGroups depend on it indefinitely.

## Post-deploy validation (continuous)

- [ ] Set up Prometheus alerts:
  - `writer_consumer_lag_messages > 10000` for any siteId → page on-call.
  - `bridge_translation_latency_ms p95 > 50ms` → warning.
  - `writer_pg_insert_latency_ms p99 > 1s` → warning.
- [ ] Set up a daily reconciliation job: query random Devices for their last 1-hour TSDB row count vs Redis Stream length. Mismatch > 1% triggers an alert.
- [ ] Capacity plan: monitor `sensor_data` table size vs retention policy. Add continuous aggregate refresh windows if compaction lag appears.

## Rollback

This change is more difficult to roll back than spec 2 because the topic-schema migration is per-SiteGroup and forward-only.

- **Rolling back the code while preserving data**: revert mqtt-bridge + tsdb-writer + simulator code to the pre-deploy version. SiteGroups in `legacy` are unaffected. SiteGroups in `dual` continue working through the legacy path (the old mqtt-bridge still subscribes to `modules/#`). SiteGroups in `new` go DARK — the old mqtt-bridge can't subscribe to `controlai/...`. Manual recovery: SQL `UPDATE "SiteGroup" SET "topicSchemaMode" = 'legacy' WHERE ...;` followed by code rollback.
- **Rolling back the Prisma schema migration**: NOT NECESSARY — the new columns have defaults and are forward-compatible. Leave them.
- **Rolling back the tsdb-writer + hypertable**: TRUNCATE the hypertable if you want to start over; or simply stop the writer. The Redis streams remain the source of truth; nothing is lost.

## Cross-check with spec 2 cleanup

Once this change is stable in production:

- Spec 2's task 2.7 (drop `Gateway.sensors` JSONB) becomes safe and can be scheduled as a follow-up cleanup.
- Spec 2's legacy widget binding field can be deprecated when `dashboard.load` confirms `bindingV2` is set on > 99% of widgets.

# Research: Default-Daemon Sandbox Hot-Reload Patterns

**Date**: 2026-05-29
**Context**: controlai-web needs a "reset + reconfigure" flow where the cloud API POSTs a new full config (broker_kind, ingest settings, tsdb settings, gateway settings) to a multi-process IoT daemon that resets all child services atomically with rollback on failure.

---

## Summary

The default-daemon orchestrates three sibling processes (broker → mosquitto or EMQX, ingest service, TimescaleDB) plus a Caddy reverse-proxy and gateway config. This research covers per-component reset semantics, atomic apply/rollback state machines, wire format trade-offs, audit trails, failure-mode recovery, and sandbox shortcuts. The five concrete pattern recommendations at the end converge on: **version-tagged JSON over HTTP → staged validation → drain-and-kill → health-check → commit-or-rollback**, with TimescaleDB wipe-and-recreate safe in sandbox mode.

---

## 1. Per-Component Reset Semantics

### 1.1 Mosquitto (eclipse-mosquitto)

| Aspect | Detail |
|--------|--------|
| **SIGHUP behavior** | Reloads config file at `-c <path>`; NOT all options reloadable. |
| **Reloadable options** | `max_queued_messages`, `max_queued_bytes`, `max_packet_size`, `memory_limit`, `persistence`, `persistence_location`, `password_file` (via `per_listener_settings`), `acl_file`, `allow_anonymous`, `set_tcp_nodelay` — per the mosquitto.conf man page marked "Reloaded on reload signal." |
| **Non-reloadable** | Listener ports (`listener`), TLS cert/key paths (`cafile`, `certfile`, `keyfile`), `protocol`, `bridge` definitions — these require a full restart. |
| **Persistence file impact** | Mosquitto writes a persistence DB (`.db` file) at `persistence_location`. On restart it reads this file to restore retained messages, subscriptions, and session state. **On a SIGHUP reload the persistence file is NOT re-read** — retained messages and sessions persist unchanged. If the new config changes the persistence path or mode, a restart is required. |
| **Strategy for reset** | For a full "blow away and restart" where the broker kind changes (e.g. mosquitto → EMQX), you MUST kill the process fully and start fresh. Use `SIGTERM` (graceful — drains pending QoS 1/2 messages) then `wait` + start. Partial reload via SIGHUP is sufficient for config changes that stay within reloadable options. |

**Source**: [mosquitto.conf man page — SIGHUP and reloadable options](https://mosquitto.org/man/mosquitto-conf-5.html); [Eclipse mosquitto SIGHUP docs](https://manpages.org/mosquitto/8)

### 1.2 EMQX

| Aspect | Detail |
|--------|--------|
| **REST admin API reload** | EMQX exposes a full OpenAPI 3.0 REST API at `/api/v5/`. Config update via `PUT /api/v5/config` or targeted endpoints. Does NOT use SIGHUP — entirely API-driven. |
| **Dynamic config endpoints** | Authentication/authorization, listeners, rules, bridges can all be modified at runtime via REST API (e.g. `POST /api/v5/authentication/{id}/users`, `PUT /api/v5/listeners/{listener_id}`). |
| **Full config replacement** | EMQX 5.x supports config backup/restore via the Dashboard and API. To fully reset, use `POST /api/v5/load_reload` or the cluster-wide config reload endpoint. Alternatively, restart with a new `emqx.conf` and check `emqx_ctl` for readiness. |
| **Persistence** | EMQX stores data in Mnesia (built-in DB). Restart with a fresh config effectively starts clean. For a full sandbox-reset, stop → truncate/remove Mnesia dir → start fresh. |
| **Key difference from mosquitto** | EMQX is API-first; config is always hot-reloadable via REST. No messy "SIGHUP partial reload" problem — but it's more resource-heavy (~120MB vs ~5MB for mosquitto). |

**Source**: [EMQX REST API docs](https://docs.emqx.com/en/emqx/latest/admin/api.html); [EMQX authorization management API](https://docs.emqx.com/en/emqx/latest/access-control/authz/authz.html)

### 1.3 TimescaleDB (TSDB)

| Aspect | Detail |
|--------|--------|
| **Schema/hypertable reset** | Hypertables are PostgreSQL tables under the hood. `DROP TABLE <hypertable> CASCADE` works. Since v2.18+, hypercore unifies rowstore/columnstore. |
| **"Wipe and recreate" safety** | ✅ Safe in sandbox mode where data loss is acceptable. Sequence: `DROP TABLE IF EXISTS ... CASCADE` → `CREATE TABLE ...` → `SELECT create_hypertable(...)`. The full PostgreSQL DDL transactional semantics apply. |
| **pg_dump requirement** | NOT needed for sandbox wipe. Only needed if migrating data between config versions. For sandbox: unconditional DROP+CREATE is correct. |
| **Retention policy changes** | `SELECT remove_retention_policy('<table>', if_exists => true)` then `SELECT add_retention_policy(...)`. Can be applied without restart — policies are stored in TimescaleDB catalog tables. |
| **Compression changes** | `ALTER TABLE <table> SET (timescaledb.compress, ...)` and `SELECT add_compression_policy(...)`. Decompression needed before schema change on compressed chunks. In sandbox mode: just DROP+CREATE. |
| **Continuous aggregate changes** | `DROP MATERIALIZED VIEW <cagg> CASCADE` → recreate. Quick operation on empty/small sandbox data. |
| **Connection drain** | Before restarting TSDB, send `pg_terminate_backend()` to all non-daemon connections, then `SIGTERM` postgres. Supervisor process re-spawns postgres, daemon reconnects. |
| **Config change via postgresql.conf** | Some params via `ALTER SYSTEM SET ...` (no restart), many require `pg_ctl reload` (SIGHUP). For sandbox full reset: stop → write new `postgresql.conf` → start. |

**Source**: [TimescaleDB hypertable docs](https://docs.tigerdata.com/docs/reference/timescaledb/hypertables); [TimescaleDB v2.27 release notes](https://github.com/timescale/timescaledb/releases/tag/2.27.1); [TimescaleDB hypertable creation guide](https://www.jusdb.com/blog/timescaledb-hypertables-continuous-aggregates-guide)

### 1.4 Ingest Service (Custom Process)

| Aspect | Detail |
|--------|--------|
| **Reset mechanism** | Kill and restart. Ingest is typically a stateless subscriber to the broker. It reads broker config, TSDB connection string, and data-mapping rules from environment or a config file. |
| **Graceful drain** | On `SIGTERM`, the ingest service should flush any in-flight batch writes to TSDB, then exit. The daemon supervisor should wait for process exit (or timeout of 30s) before killing with `SIGKILL`. |
| **Strategy** | For a full config reset: stop ingest → stop broker → wipe TSDB → start TSDB → start broker → start ingest (dependency order). Or: stop all → reconfigure → start all (simpler, more atomic). |

---

## 2. Daemon-Side Patterns for Atomic Full-Config Apply

### 2.1 Stage → Validate → Swap → Restart → Health-Check → Commit/Rollback

This is the canonical pattern used by Caddy, Envoy xDS, and production-grade config managers:

```
                    ┌──────────────────────┐
                    │ POST /v1/reload      │
                    │ (new full config)    │
                    └──────────┬───────────┘
                               ▼
                    ┌──────────────────────┐
                    │ 1. STAGE             │
                    │ Write new config to   │
                    │ staging area (/tmp,   │
                    │ versioned dir)        │
                    └──────────┬───────────┘
                               ▼
                    ┌──────────────────────┐
                    │ 2. VALIDATE           │
                    │ - JSON schema check   │
                    │ - mosquitto: -c test  │
                    │ - EMQX: API dry-run   │
                    │ - TSDB: SQL syntax    │
                    │ - Ingest: own check   │
                    └──────────┬───────────┘
                    ┌──────────┴───────────┐
                    ▼                      ▼
              VALID ✓               VALID ✗
                    │                      │
                    ▼                      ▼
        ┌──────────────────────┐    ┌──────────────────────┐
        │ 3. SWAP              │    │ Return 422 with       │
        │ Atomic symlink or     │    │ validation errors     │
        │ copy to live path    │    │ (no restart!)         │
        └──────────┬───────────┘    └──────────────────────┘
                   ▼
        ┌──────────────────────┐
        │ 4. RESTART CHILDREN  │
        │ (ordered by deps)    │
        │ TSDB → Broker →      │
        │ Ingest → Caddy       │
        └──────────┬───────────┘
                   ▼
        ┌──────────────────────┐
        │ 5. HEALTH-CHECK      │
        │ Each child: poll      │
        │ /health (or pg_isready│
        │ for TSDB) with timeout│
        │ (e.g. 30s per child)  │
        └──────────┬───────────┘
        ┌──────────┴───────────┐
        ▼                      ▼
   ALL HEALTHY          ANY FAILS
        │                      │
        ▼                      ▼
┌──────────────────┐  ┌──────────────────────┐
│ 6a. COMMIT       │  │ 6b. ROLLBACK         │
│ - Persist        │  │ - Kill failed child  │
│   config version │  │ - Restore old config │
│ - Log success    │  │ - Restart old chain  │
│ - Return 200     │  │ - Return 500/502     │
└──────────────────┘  └──────────────────────┘
```

### 2.2 Compare-and-Swap vs. Version-Tagged Config

| Approach | Mechanism | Pros | Cons |
|----------|-----------|------|------|
| **Compare-and-Swap (CAS)** | Daemon keeps `current_config` in a `sync.RWMutex` or `atomic.Pointer`. New config is staged, validated, then atomically swapped via pointer assignment. Config is the payload JSON itself. | Simple, no version bookkeeping, low memory overhead. | No audit trail of "what was applied when." Hard to reason about idempotency from the caller side. |
| **Version-Tagged** | Each config POST includes a `version` field (monotonic integer). Daemon rejects versions ≤ current. Audit log records `version + timestamp + caller`. | Clean audit trail. Idempotent (re-send same version = no-op). Caller can detect conflicts. | Slightly more state to manage. Must persist "last applied version" to survive daemon restart. |

**Recommendation**: Use **version-tagged** with `version` as a monotonic integer always incremented by the caller (controlai-web). The daemon rejects stale versions. The version is persisted to a small JSON file on disk so the daemon remembers it across restarts. The caller knows the current version from `GET /v1/status`.

### 2.3 Surfacing Validation Errors Before Restart

The critical architectural requirement: **never restart a child if validation fails**. The caller gets errors synchronously:

```
HTTP POST /v1/reload { "version": 42, "broker": { "kind": "mosquitto", ... }, ... }

HTTP 422
{
  "error": "VALIDATION_FAILED",
  "version": 42,
  "rejected": true,
  "children": {
    "broker": {
      "kind": "mosquitto",
      "error": "listener port 1883 conflicts with existing syslog",
      "reloadable": false
    },
    "tsdb": {
      "error": null
    },
    "ingest": {
      "error": "Unknown data-mapping schema 'v3' — valid: [v1, v2]"
    }
  }
}
```

The daemon runs **per-component validation in isolation**:
- mosquitto: `mosquitto -c /tmp/staged/mosquitto.conf -t` (config test mode)
- EMQX: `POST /api/v5/check_config` (dry-run) if available; else validate known constraints server-side
- TSDB: Connect to running postgres, use `SET client_min_messages=ERROR; EXPLAIN (COSTS OFF) <DDL>` to check SQL syntax
- Ingest: Parse the ingest config into internal structs, return typed errors

### 2.4 Reference: Caddy Admin API /load

Caddy's `POST /load` is the best reference for the atomic swap pattern:

> **POST /load** — Sets Caddy's configuration, overriding any previous configuration. It blocks until the reload completes or fails. Configuration changes are lightweight, efficient, and incur zero downtime. **If the new config fails for any reason, the old config is rolled back into place without downtime.**

This is exactly the contract we want. Caddy achieves this by:
1. Deserializing and validating the JSON config
2. Swapping in-memory config atomically
3. Reconfiguring HTTP servers on the fly (no restart)
4. If error → restore old config

**Source**: [Caddy API docs — POST /load](https://caddyserver.com/docs/api)

---

## 3. Wire Format Options

| Format | Schema Evolution | Validation (client + server) | Human Readability | Payload Size | Protobuf/Codegen |
|--------|-----------------|------------------------------|-------------------|-------------|------------------|
| **JSON** | Manual `version` field in payload; JSON Schema for optional validation | JSON Schema on both sides via `ajv` (client) + `zod`, `jsonschema` (server) | Excellent | Verbose but fine for config (<10KB) | None needed |
| **JSON + OpenAPI 3.0** | OpenAPI spec defines schema; `version` field in payload; spec-incompatible changes = new API version | OpenAPI validation middleware on server; OpenAPI-generated client types | Excellent | Same as JSON | `openapi-typescript` for typed client |
| **YAML** | Same as JSON (no built-in versioning) | Python `pyyaml`/`cerberus`, JS `js-yaml` + `zod` | More readable than JSON for large configs | Slightly larger than JSON | None needed |
| **Protobuf** | Field numbers + wire-format evolution; Schema Registry for compatibility tracking | Codegen-based (strict), server validates via proto reflection | Terrible (binary) | ~3-5× smaller than JSON | Need `.proto` files + codegen in both stacks |
| **TOML** | No built-in versioning | Minimal validation libraries | Very readable for simple configs | ~JSON size | None needed |

### Recommendation

**JSON with OpenAPI 3.0 schema served by the daemon at `/v1/reload-schema`**.

Rationale:
- **Schema evolution**: Add `version` field to payload; breaking changes bump the `version` and the daemon rejects mismatched versions at validation time before any restart. No schema registry needed.
- **Validation**: JSON Schema on the server (Rust? Go? TypeScript with `zod` for the daemon). The OpenAPI spec is the contract controlai-web builds against.
- **Human readability**: Operators can `curl` the daemon and inspect the config easily. Critical for debugging in sandbox mode.
- **YAML alternative**: Acceptable too if human readability is paramount. YAML supports comments (JSON doesn't). Can accept both using `Content-Type: application/json` or `application/x-yaml`.

---

## 4. Reset Audit Trail

### 4.1 How Reference Systems Log Config Changes

| System | Mechanism |
|--------|-----------|
| **Telegraf** | Logs `"Reloading config"` at INFO level to `telegraf.log`. Flushes all buffered points before restart. No structured audit record per reload. |
| **Vector** | `component_events_total` metric captures config-reload counter. Logs at INFO on successful reload, ERROR on failure. |
| **Fluent Bit** | Exposes `GET /api/v2/reload` returning `{"hot_reload_count": N}`. No user attribution built-in. |
| **Caddy** | Admin API `/load` returns success/error; logs at INFO. No built-in audit version history. |
| **Nexus IOS (non-software reference)** | `checkpoint` + `rollback` — explicit snapshot naming. Best-in-class for audit: "rollback to checkpoint 'pre-change-2026-05-29' executed by user 'admin'." |

### 4.2 Proposed Audit Log Schema for Our Daemon

The daemon should maintain an append-only JSONL audit file in its data directory:

```jsonl
{"version":41,"action":"RELOAD","status":"SUCCESS","caller_ip":"10.0.1.5","caller_jwt_sub":"user_abc123","ts":"2026-05-29T12:34:56Z","children":{"broker":{"action":"restart","status":"ok"},"tsdb":{"action":"wipe_and_recreate","status":"ok"},"ingest":{"action":"restart","status":"ok"}}}
{"version":42,"action":"RELOAD","status":"VALIDATION_FAILED","caller_ip":"10.0.1.5","caller_jwt_sub":"user_abc123","ts":"2026-05-29T12:35:10Z","errors":{"broker":"listener port conflict"}}
{"version":43,"action":"RELOAD","status":"ROLLED_BACK","caller_ip":"10.0.1.5","caller_jwt_sub":"user_abc123","ts":"2026-05-29T12:36:00Z","failure_child":"ingest","failure_reason":"health_check_timeout","rollback_to_version":42}
```

This provides:
- "Reset version N at HH:MM by user X" story
- Per-child outcome granularity  
- Rollback linkage (which version was restored)

**Exposed via**: `GET /v1/audit?since=<iso-timestamp>` returns audit log entries. All audit records are forwarded to controlai-web's central logging as structured JSON.

---

## 5. Failure Modes

### 5.1 Partial-Apply: Broker Restarted but Ingest Failed

This is the worst case. The state machine handles it:

```
1. Drain broker (suspend new connections, let pending messages drain)
2. Kill broker
3. Wipe TSDB + restart
4. Start new broker    ← success
5. Start new ingest    ← FAIL (invalid config)
6. → ROLLBACK path:
   a. Kill broker
   b. Kill TSDB
   c. Restore old TSDB (restore from pg_dump if data matters, or re-wipe-and-start if sandbox)
   d. Restore old broker config + restart
   e. Restore old ingest config + restart
   f. Health-check all
   g. Return 502 with details
```

### 5.2 Forced-Rollback After Timeout

Each child restart has a configured timeout (default: 30s, configurable in daemon config). If a child fails to enter healthy state within the timeout, the daemon:

1. **Aborts** the remaining children start sequence
2. **Kills** any children already started (SIGTERM → wait 10s → SIGKILL)
3. **Restores** from staged backup of the *previous* config version
4. **Re-starts** the old config chain
5. Health-checks all
6. On success of old config: return 502 with "rolled back to version N"
7. On failure of old config: **critical failure** — daemon emits alert to watchdog/supervisor

### 5.3 "Drain Old Config" Before Swap

Before killing any process, the daemon should:

- **Broker**: Send `SIGUSR1` (mosquitto: tells clients to disconnect gracefully) or suspend EMQX listener; wait `drain_timeout` (default 10s) for in-flight QoS 1/2 messages to complete.
- **Ingest**: Send `SIGTERM`; wait for graceful shutdown (flush in-flight writes).
- **TSDB**: For sandbox mode, no drain needed (data is dropped anyway). For production: `pg_dump` then `pg_ctl stop -m smart` (waits for clients to disconnect).

### 5.4 Reference: Envoy xDS Failure Handling

Envoy's xDS protocol handles partial config failure gracefully:
- Each discovery type (LDS, RDS, CDS, EDS) is independent
- If a new listener config fails, Envoy keeps the old listener running
- Resources are "warmed" before being used (connection pools are pre-established)
- Rejected resources don't break already-working resources

This is the gold standard for partial failure isolation. Our daemon can't fully replicate this across separate OS processes, but the **per-child health check + independent rollback per child** is the closest approximation.

---

## 6. Reference Implementations

| System | Reload Mechanism | Notes |
|--------|-----------------|-------|
| **[Caddy](https://caddyserver.com/docs/api)** | `POST /load` — atomic swap, zero-downtime, auto-rollback on failure | ✅ Already in our stack (Caddy reverse proxy pool per design.md). The admin API is our model. |
| **[Fluent Bit](https://docs.fluentbit.io/manual/administration/hot-reload)** | `PUT/POST /api/v2/reload` or SIGHUP when `hot_reload: on`. Supports pipeline hot-swap. | Requires `--enable-hot-reload` flag. HTTP-driven. Counter at `GET /api/v2/reload`. |
| **[Envoy xDS](https://www.envoyproxy.io/docs/envoy/latest/api-docs/xds_protocol)** | gRPC streaming via control plane (SotW/Delta xDS). Per-resource-type isolation. Warm config before swap. | Most sophisticated. Overkill for our daemon but the "warm before swap" principle applies. |
| **[Telegraf](https://www.influxdata.com/blog/continuous-deployment-of-telegraf-configurations/)** | SIGHUP triggers full restart of collector with new config. Brief downtime during reload. | Simple, reliable. Logs buffered write, then restarts child plugins. |
| **[Vector](https://vector.dev/docs/)** | SIGHUP triggers config reload. Topology is diffed and components restarted only when changed. | State-of-the-art incremental reload for observability pipelines. |
| **[Grafana Alloy](https://deepwiki.com/grafana/Building-OpenTelemetry-and-Prometheus-native-telemetry-pipelines-with-Grafana-Alloy/5.2-dynamic-configuration-reloading)** | `POST /-/reload` HTTP endpoint. Validates, then applies new config. | Shadow-loading pattern: parse new config into temp structs before replacing live ones. |
| **OpenTelemetry Collector** | SIGHUP via systemd `ExecReload`. Config validation first via `otelcol --dry-run`. | "Validate before reload" is the key lesson. |

---

## 7. Sandbox Semantics: Shortcuts and Trade-Offs

In sandbox mode, data loss on reset is **acceptable by design**. This unlocks aggressive shortcuts:

### Allowed Shortcuts (Sandbox-Only)

| Area | Sandbox Shortcut | Production Alternative |
|------|-----------------|----------------------|
| **TSDB** | `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` — nuke everything and recreate. No backup needed. | `pg_dump` selective tables, `DROP TABLE ... CASCADE` + `ALTER TABLE ...`, retention policies. |
| **Broker (mosquitto)** | Delete persistence `.db` file + restart broker. No message recovery. | Preserve persistence file; only SIGHUP for reloadable options. |
| **Broker (EMQX)** | Delete Mnesia directory + restart EMQX. Clean slate. | Use REST API for incremental changes; config export before restart. |
| **Ingest** | Kill -9 + restart. No in-flight flush needed. | SIGTERM + wait for flush + validation. |
| **Hypertable changes** | Unconditional `DROP TABLE ... CASCADE` — schema change is free when data is empty. | Use `ALTER TABLE` with `timescaledb.compress`, `SELECT decompress_chunk()`, etc. |
| **Retention policies** | Drop and recreate. | `remove_retention_policy()` + `add_retention_policy()`. |
| **Continuous aggregates** | Drop and recreate. | `ALTER MATERIALIZED VIEW ...` for schema changes (limited). |
| **Audit log** | Keep audit JSONL even in sandbox (it's tiny and useful). | Same approach, plus ship to central log. |
| **Backup before reset** | Skip. | Always `pg_dump` TSDB + export mosquitto/EMQX config. |

### Trade-Off Table

| Shortcut | Speed Gain | Risk | When to Skip |
|----------|-----------|------|-------------|
| `DROP SCHEMA CASCADE` | Seconds instead of minutes for pg_dump | Total data loss | Data has any value |
| Kill -9 vs SIGTERM | ~10s faster | Orphaned state, corrupted persistence | Ingest is mid-write |
| No config backup before swap | ~1s faster | Rollback is impossible | Sandbox: rollback not needed |
| Delete mosquitto `.db` | ~500ms faster | Lost retained/subscriptions | Persistence matters |

### Decision Tree for Sandbox Mode

```
Is this a sandbox daemon?
├─ YES:
│  └─ Is there any data worth keeping?
│     ├─ NO  → DROP SCHEMA CASCADE, kill -9, skip backup (fastest reset)
│     └─ YES → Use production-like reset but skip pg_dump backup
├─ NO (production):
│  └─ pg_dump TSDB, graceful SIGTERM to all children,
│     staged config swap with full health-check + rollback
```

---

## Concrete Pattern Recommendations

### Pattern 1: Version-Tagged POST /v1/reload with Pre-Validation

**Contract**:
```
POST /v1/reload
Content-Type: application/json
{
  "version": 42,
  "broker": { "kind": "mosquitto" | "emqx", ... },
  "tsdb": { "schema_version": 3, ... },
  "ingest": { "data_mapping": "v2", ... },
  "gateway": { ... }
}

→ 200 OK (applied), 422 (validation failed, not applied), 500/502 (applied but rolled back)
```

**Key design**: Synchronous return — the caller blocks until the reset is complete OR validation fails. No async polling for simple sandbox reset.

### Pattern 2: Stage Directory + Atomic Symlink

```
/var/lib/controlai-daemon/
  config/
    current -> versions/v41/          # Symlink to active config
    versions/
      v41/
        full-config.json              # The version-tagged payload
        mosquitto.conf                # Generated per-component configs
        mosquitto-test.conf
        tsdb/
          init.sql                    # DDL for hypertables
          postgresql.conf
        ingest/
          config.toml
        caddy/
          routes.json
      v42/                           # Staged by /v1/reload before validation
        full-config.json
        ...
```

- Write new config to a fresh `v{N+1}` directory
- Validate each child config individually
- On validation failure: **delete staged dir**, return 422
- On success: `ln -sfn versions/v{N+1} current`, then restart children
- If rollback: restore symlink to previous version, restart children

### Pattern 3: Ordered Restart with Dependency Graph

```
Restart Order:
  1. TimescaleDB (no deps)           → health: pg_isready
  2. Broker mosquitto/EMQX (needs    → health: MQTT connect test
     TSDB for auth plugin if used)
  3. Ingest (needs broker + TSDB)    → health: HTTP /health
  4. Caddy (needs nothing)           → health: POST /load
  5. Gateway (needs Caddy)           → health: HTTP /v1/health

Shutdown Order (reverse):
  1. Gateway → 2. Ingest → 3. Broker → 4. TSDB
```

Each step has a timeout (30s). On timeout, the entire apply is aborted and rollback begins.

For sandbox mode, the shutdown can be parallelized (kill all children simultaneously, then start in dependency order).

### Pattern 4: "Warm before Swap" for TSDB Schema

Even in sandbox mode, apply the new schema **before** swapping the broker:

```
1. Connect to running TSDB instance
2. Execute new DDL (DROP/ CREATE / hypertable creation)
3. Verify schema with a test INSERT + SELECT
4. *Then* restart broker + ingest (they'll connect to an already-ready TSDB)
```

This reduces the time window where TSDB is unavailable. The broker and ingest restarts are then "reconnect only" rather than "wait for TSDB."

### Pattern 5: Reset Budget Enforcement

The daemon enforces a total reset budget:
- **P99 target**: 15s for sandbox reset (aggressive: no backup, parallel kill, single health-check).
- **Hard timeout**: 60s. After 60s, any still-restarting child is considered FAILED, and rollback begins.
- **Caller-facing timeout**: controlai-web's HTTP client sets a 120s timeout (matching the instance-provisioning pattern from `design.md` §8).

If the daemon knows it cannot meet the budget (e.g., broker binary not found), it fails fast (<500ms) with a clear error — never hangs.

---

## Key References

- [Caddy Admin API — POST /load](https://caddyserver.com/docs/api) (atomic swap + rollback)
- [mosquitto.conf man page — SIGHUP reloadable options](https://mosquitto.org/man/mosquitto-conf-5.html)
- [EMQX REST API docs](https://docs.emqx.com/en/emqx/latest/admin/api.html)
- [Fluent Bit hot-reload docs](https://docs.fluentbit.io/manual/administration/hot-reload)
- [Envoy xDS protocol](https://www.envoyproxy.io/docs/envoy/latest/api-docs/xds_protocol) (dynamic config, per-resource isolation)
- [OpenTelemetry Collector hot-reload via SIGHUP](https://last9.io/blog/hot-reload-for-opentelemetry-collector)
- [TimescaleDB hypertable docs](https://docs.tigerdata.com/docs/reference/timescaledb/hypertables)
- [Grafana Alloy dynamic config reloading](https://deepwiki.com/grafana/Building-OpenTelemetry-and-Prometheus-native-telemetry-pipelines-with-Grafana-Alloy/5.2-dynamic-configuration-reloading) (shadow-loading pattern)
- Caddy reverse proxy pool pattern: [design.md §2 (Ingress)](https://github.com/controlai/controlai-web/blob/main/openspec/changes/add-ec2-container-provisioner/design.md)

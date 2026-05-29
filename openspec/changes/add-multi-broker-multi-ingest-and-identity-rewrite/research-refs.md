# Research references — add-multi-broker-multi-ingest-and-identity-rewrite

## Saved research documents

- `.slash/workspace/research/identity-rewrite-and-provisioning.md` — recommended `device_key` as the stable TSDB partition key + topic routing key. This change is the final enforcement step. Also covered: step-ca / Smallstep for cert issuance (we keep the existing daemon's PKI; revocation hook lives in spec 3).
- `.slash/workspace/research/device-type-registry-prior-art.md` — the driver registry mirrors the device-type registry pattern; both are in-repo TS modules with Zod validation and import-time side-effects.

## Key external references

- TimescaleDB hypertable + continuous aggregate docs — `https://docs.timescale.com/use-timescale/latest/hypertables/` and `https://docs.timescale.com/use-timescale/latest/continuous-aggregates/`.
- Redis Streams consumer groups — `https://redis.io/docs/data-types/streams/#consumer-groups`. We use XREADGROUP with manual ACK + ON CONFLICT DO NOTHING for double-fence idempotency.
- `kafkajs` — `https://kafka.js.org/docs/getting-started`.
- Web Crypto HMAC-SHA256 for http-webhook-driver signature validation — standard Node `crypto.createHmac`.
- node-pg-migrate — `https://salsita.github.io/node-pg-migrate/`. Drives `apps/tsdb-writer/src/migrations/`.

## Internal references

- `openspec/changes/add-plugin-device-type-registry/proposal.md` — the registry/manifest pattern is reused for drivers.
- `openspec/changes/add-unregistered-device-lifecycle/proposal.md` — provides the Device table with `deviceKey` that this change routes by.
- `openspec/changes/extend-gateway-register-handshake/proposal.md` — provides the gateway register / `realUuid` semantics; spec 4 routes by `deviceKey` so realUuid rewrites do not affect routing.
- `apps/mqtt-bridge/src/mqtt-manager.ts` — current monolithic MQTT handler that becomes the mqtt-driver.
- `apps/mqtt-bridge/src/redis-writer.ts` — current Redis key writer that gains dual-stack writes.
- `apps/mqtt-bridge/src/sse-fanout.ts` — current SSE emitter that gains dual-stack events.
- `packages/api/src/lib/apply-planner.ts` — current planner extended with two new op types.
- `packages/api/src/routers/apply.ts` — current commit handler extended with two new op handlers.
- The operator-pasted DAEJAK CLI dump (in spec 3's design) — explains why the legacy schema MUST be preserved via the translator in `dual` mode for SiteGroups containing DAEJAK boards.

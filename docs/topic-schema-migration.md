# Topic-Schema Migration Runbook

The legacy MQTT topic format is `modules/{groupId}/{NBIRTH|NDATA|NDEATH}/{clientId}`
with CBOR payloads. The new topic format is
`controlai/{siteId}/{deviceKey}/{dataType}` with JSON payloads.

Each `SiteGroup` carries a `topicSchemaMode` flag with three values:

| mode    | publishes to            | subscribes to              |
| ------- | ----------------------- | -------------------------- |
| legacy  | modules/...             | modules/...                |
| dual    | modules/... and controlai/... | both                 |
| new     | controlai/...           | controlai/...              |

Migration is **forward-only**: `legacy → dual → new`. Downgrade is not allowed
by the apply pipeline (returns BAD_REQUEST).

## Migration phases

### Phase 1 — pre-deploy

- Confirm every Gateway in the target SiteGroup has `Gateway.deviceKey` set.
  Run `pnpm --filter @controlai-web/db db:backfill-gateway-keys` if any are
  null. The startup gate blocks the API in production when nulls are present.

### Phase 2 — dual

- Toggle SiteGroup to `dual` mode (via canvas `targetTopicSchemaMode` node-data
  field, picked up by the next apply run).
- mqtt-bridge orchestrator subscribes to BOTH legacy and new topics.
- simulator emits BOTH legacy and new topics.
- Dashboard SSE adapter normalizes both shapes to `NormalizedMessage`.

### Phase 3 — new

- Run integration smoke for ≥24h in `dual`.
- Toggle SiteGroup to `new`. The apply handler refuses this transition when
  any Gateway in the SiteGroup has a 24-hex DAEJAK clientId (firmware can't
  publish on the new topic format yet).
- mqtt-bridge subscribes to `controlai/...` only.
- Legacy CBOR encoding is no longer emitted.

## Audit trail

Every transition writes `apply.migrate-topic-schema` to the AuditLog with
`{ before, after }` metadata.

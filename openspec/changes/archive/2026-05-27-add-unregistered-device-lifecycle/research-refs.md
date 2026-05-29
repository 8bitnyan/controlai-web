# Research references — add-unregistered-device-lifecycle

## Saved research documents

- `.slash/workspace/research/identity-rewrite-and-provisioning.md` — analyses AWS IoT JITP, Azure DPS, ThingsBoard claim flow; recommends stable surrogate (`device_key`) with an alias table holding `shadowUuid` + `realUuid`. This change implements the alias-table half (the row IS the alias table); spec 3 performs the actual UUID swap; spec 4 routes topics + TSDB through `device_key`.

## Key external references

- Prisma soft-delete patterns — `https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types/soft-deletes`. We use a state enum instead of a `deletedAt` timestamp because the canvas already needs `ORPHANED` for visual handling.
- TimescaleDB hypertable partitioning guidance — `https://docs.timescale.com/use-timescale/latest/hypertables/`. We do not create the hypertable in this change (spec 4), but the `device_key` is the partition key it will use.
- Token bucket rate limiting reference — see `https://en.wikipedia.org/wiki/Token_bucket`. Single-file implementation in `packages/shared/src/token-bucket.ts`.

## Internal references

- `openspec/changes/add-plugin-device-type-registry/proposal.md` — this spec depends on the manifest registry's `deviceTypeId` and the orphan-type UI pattern, which is mirrored here.
- `openspec/specs/gateway-board-provisioning/spec.md` — existing spec defining the certs and serial provisioning that this change does NOT modify; spec 3 extends it.
- `packages/db/prisma/schema.prisma` lines 297-324 — current Gateway model that is extended here.
- `packages/api/src/routers/dashboard.ts` — current dashboard CRUD that gains the binding-migration logic.
- `apps/web/components/dashboard/widgets/*` — current widget components that read `binding` and gain `bindingV2` support.
- `apps/simulator/src/manager.ts` — current Gateway.sensors-JSONB consumer that gains Device-row consumer + token-bucket cap.

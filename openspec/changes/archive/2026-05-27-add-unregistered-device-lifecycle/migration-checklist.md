# Migration checklist — add-unregistered-device-lifecycle

This change introduces a new `Device` table and migrates `Gateway.sensors` JSONB into individual `Device` rows. Run this checklist BEFORE merging to production.

## Pre-deploy

- [ ] **Snapshot the database**. Take a full Postgres `pg_dump` (or platform-native snapshot) immediately before applying the new migration. Tag with `pre-device-lifecycle-<git-sha>`.
- [ ] **Count current sensors in production**: `SELECT SUM(jsonb_array_length(sensors)) FROM "Gateway" WHERE sensors IS NOT NULL;` — record the number.
- [ ] **Count Gateways with empty sensors**: `SELECT COUNT(*) FROM "Gateway" WHERE jsonb_array_length(sensors) = 0 OR sensors IS NULL;` — record.
- [ ] **Identify ALL SiteGroups exceeding the 1,000 msg/s simulator cap**. Run `SELECT siteGroupId, COUNT(*) AS sensorCount FROM <derived view> GROUP BY siteGroupId HAVING ... > <est>;`. For each SiteGroup over budget, notify the SiteGroup owner; document the over-cap list as an exception to the perf budget (continue with deploy, but the cap will throttle them post-deploy).
- [ ] **Verify spec 1 (`add-plugin-device-type-registry`) is already applied in production**. The migration depends on `core-generic-*` manifests being present.
- [ ] **Run the migration in staging end-to-end**:
  - [ ] Restore the production snapshot into a staging DB.
  - [ ] Apply the Prisma migration `add-device-table-and-lifecycle`.
  - [ ] Run `pnpm --filter @controlai-web/db db:migrate-devices --dry` and inspect the dry-run output. Confirm `createdDeviceCount == sum-of-sensors + count-of-gateways-with-zero-sensors`.
  - [ ] Run `pnpm --filter @controlai-web/db db:migrate-devices` for real.
  - [ ] Re-run with no args; confirm zero new rows (idempotency).
  - [ ] Open the staging canvas for a non-trivial SiteGroup; verify all nodes render with correct "Unregistered" / "Registered" badges and identifiers.
  - [ ] Open a dashboard with legacy widgets; verify they keep rendering live data after the binding-migration runs on load.
- [ ] **Approve maintenance window**. Total downtime estimate: 0 (online migration), but elevated DB load for ~5 minutes during the `db:migrate-devices` run on production.

## Deploy

- [ ] Pause web ingress (or route to a maintenance page) — not strictly required (migration is online) but recommended to avoid races between users adding new canvas nodes and the migration script reading sensors.
- [ ] Deploy the new code to all environments (web, api, simulator, mqtt-bridge).
- [ ] Apply the Prisma migration: `pnpm --filter @controlai-web/db prisma migrate deploy`.
- [ ] Run `pnpm --filter @controlai-web/db db:migrate-devices`. Tail logs.
- [ ] **Verify**:
  - [ ] `SELECT COUNT(*) FROM "Device";` matches the pre-deploy "current sensors + gateway count" total.
  - [ ] `SELECT COUNT(*) FROM "Gateway" WHERE "deviceKey" IS NULL;` returns 0.
  - [ ] Sample 3 SiteGroups: open their canvas and Devices tab; visually confirm sensors are present.
  - [ ] Sample 3 dashboards: confirm at least 2 widgets each show fresh data.
- [ ] Re-enable web ingress.

## Post-deploy validation (within 1 hour)

- [ ] Tail simulator logs for `sim-falling-back-to-jsonb` events. Expected: zero. Investigate every occurrence.
- [ ] Tail simulator metrics: `sim_rate_cap_delays_total` should be 0 for under-cap SiteGroups; bounded for the documented over-cap SiteGroups.
- [ ] `device_canvas_reconcile` job (if enabled): tail audit log for `device.reconcile-mismatch` action. Expected: zero. Investigate every occurrence.
- [ ] Pick 3 users with active dashboards; confirm via Sentry / logs that no widget rendered the "Binding migration needed" overlay.

## Rollback

If any of the post-deploy validations fail catastrophically (mass widget breakage, >5% of dashboards needing manual rebind, simulator publishing the wrong identities):

- [ ] Revert the application code deploy to the previous version.
- [ ] **DO NOT** roll back the Prisma migration directly — the new tables exist and reverting would lose any Device rows created after the migration. Instead:
  - [ ] Restore the pre-deploy `pg_dump` snapshot to a parallel database.
  - [ ] Switch the application's `DATABASE_URL` to point at the restored snapshot.
  - [ ] Open an incident postmortem.
- [ ] Any Device rows created via canvas drops between the deploy and the rollback are lost. This is an accepted trade-off because the new schema and the legacy schema cannot coexist for write traffic.

## Cleanup (next minor release, NOT part of this change)

- [ ] Drop the `Gateway.sensors` JSONB column via a follow-up Prisma migration.
- [ ] Remove the `sim-falling-back-to-jsonb` branch in `apps/simulator/src/manager.ts`.
- [ ] Remove the legacy `binding` field from the Dashboard widget schema once `bindingV2` is non-null for >99% of widgets in production (queried via a Prometheus metric on `dashboard.load`).

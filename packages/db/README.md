# @controlai-web/db

## Device migration runbook

Run sensor/gateway to Device migration for one site group:

```bash
pnpm --filter @controlai-web/db db:migrate-devices -- --site-group <siteGroupId>
```

Preview only (no writes):

```bash
pnpm --filter @controlai-web/db db:migrate-devices -- --site-group <siteGroupId> --dry
```

Backfill missing `Gateway.deviceKey` links for already-migrated gateways:

```bash
pnpm --filter @controlai-web/db db:backfill-gateway-keys -- --site-group <siteGroupId>
```

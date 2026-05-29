# Change: Auto-provision ControlAI daemon instances on demand

## Why

Today every customer onboarding requires ops to stand up a daemon, mint a bearer token, hand it to the customer, and have the customer paste both `baseURL` and `bearerToken` into the dashboard. That gates self-service signup on a human and exposes raw tokens in chat. For managed-tier customers we want one-click provisioning: pick env, click Provision, and the dashboard spawns a fresh daemon container on existing bin-packed EC2 capacity, stores the resulting token encrypted, and surfaces it in the Instances list. The BYO path (`instance.register`) stays untouched for on-prem / air-gapped customers.

This change ships the **contract layer** (DB schema, provisioner interface, tRPC procedures, UI, mock implementation). The real EC2 bin-pack scheduler implementation is intentionally deferred to a follow-up change — its design (node selection, port allocation, ingress wiring, token injection) is a separate sizable surface that should not be rushed inside this spec.

## What Changes

- **ADD** `instance.provision` tRPC mutation (owner+admin only): input is `{ orgId, name, env }`; server derives `baseURL = https://{org.slug}-{env}.{DAEMON_BASE_DOMAIN}`; inserts row in `PROVISIONING` state and returns id immediately; background job calls provisioner; UI polls `instance.get` until `HEALTHY` or `PROVISION_FAILED`.
- **ADD** `instance.retryProvision` tRPC mutation for stuck/failed rows (idempotent).
- **ADD** `instance.deprovision` tRPC mutation: refuses when Projects reference the instance; calls `provisioner.deprovision()` then deletes the row.
- **ADD** pluggable `InstanceProvisioner` interface in `packages/api/src/lib/instance-provisioner.ts`. v1 ships **one implementation**: `mock` (synthetic token, no network) — used for tests, local dev, and the initial UI ship. Selected via `INSTANCE_PROVISIONER` env var.
- **NON-GOAL (deferred to follow-up spec):** real `Ec2ContainerProvisioner` implementation. The interface is provider-agnostic so the follow-up can land without changing the procedure layer or DB schema.
- **ADD** `env` ('prod' | 'staging' | 'dev'), `provisioningStartedAt`, and `provisionerInstanceId` columns on `ControlaiInstance`. All nullable so existing BYO rows are unaffected.
- **ADD** `PROVISIONING` and `PROVISION_FAILED` values to `InstanceStatus` enum.
- **ADD** Partial unique index `(orgId, env) WHERE env IS NOT NULL` to enforce one managed daemon per (org, env) — BYO rows exempt.
- **ADD** `Organization.slug` is treated as immutable; documented in `docs/instance-byo-vs-managed.md`. (Column already exists `@unique`; no migration needed.)
- **ADD** scheduled cleanup: rows in `PROVISION_FAILED` older than 24h are auto-deleted (best-effort: deprovision first if `provisionerInstanceId` exists).
- **ADD** Provision Instance dialog on the Instances page, side-by-side with the existing "Add existing daemon" form. With the mock provisioner the dialog is fully functional for demo/QA; switching to the real provisioner is a follow-up change.
- **NON-GOAL** Region geo-routing — URL shape supports trailing tags so adding region later is non-breaking.
- **NON-GOAL** Token rotation.
- **NON-GOAL** Customer-BYO custom domain for the monitoring dashboard — separate future feature; this spec is forward-compatible with it.

## Impact

- **Affected specs (new):** `instance-management`, `organization`.
- **Affected code:**
  - `packages/db/prisma/schema.prisma` — 3 new nullable columns, 2 new enum values, 1 hand-written migration with partial unique index.
  - `packages/api/src/routers/instance.ts` — 3 new procedures.
  - `packages/api/src/lib/instance-provisioner.ts` — new module + interface + mock impl + factory.
  - `packages/api/src/lib/provision-task.ts` — background task that calls the provisioner.
  - `packages/api/src/lib/org-slug.ts` — pure subdomain derivation helper.
  - `packages/shared-types/src/validation.ts` — new Zod schemas.
  - `apps/web/components/instances/provision-instance-dialog.tsx` — new UI.
  - `apps/web/app/[org]/instances/page.tsx` — wire both flows.
  - `apps/web/lib/cron/cleanup-failed-provisions.ts` — new cleanup tick.
  - `docs/instance-provisioning.md`, `docs/instance-byo-vs-managed.md` — new docs.
- **New env vars:** `DAEMON_BASE_DOMAIN`, `INSTANCE_PROVISIONER` (`mock` in v1).
- **Cost impact (informational, depends on follow-up impl):** target architecture is bin-packed containers on existing EC2 (~$0.60/daemon/mo at 50 daemons per t3.medium). v1 alone has zero infra cost (mock).
- **Security:** plaintext bearer tokens never persist; provisioner returns plaintext synchronously → immediately encrypted with `encryptToken()` before any DB write.

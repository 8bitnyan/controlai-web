# Tasks: add-instance-auto-provisioning

## 1. Schema & migration

- [ ] 1.1 Edit `packages/db/prisma/schema.prisma` — add `env String?`, `provisioningStartedAt DateTime?`, `provisionerInstanceId String?` columns on `ControlaiInstance`; add `PROVISIONING`, `PROVISION_FAILED` to `InstanceStatus` enum. (Partial unique index is not expressible in Prisma schema; enforced via raw SQL in the migration only.)
- [ ] 1.2 Write hand-rolled migration at `packages/db/prisma/migrations/<timestamp>_add_instance_provisioning/migration.sql` with: ALTER TYPE enum values, ADD COLUMN x3, partial unique index `WHERE env IS NOT NULL`.
- [ ] 1.3 Run `pnpm --filter @controlai-web/db prisma generate` and commit generated client diff.
- [ ] 1.4 Apply migration locally via `pnpm --filter @controlai-web/db prisma migrate deploy`; confirm schema matches.

## 2. Shared validation schemas

- [ ] 2.1 In `packages/shared-types/src/validation.ts`, add `ProvisionInstanceSchema` ({ orgId, name 1–128, env enum }), `RetryProvisionSchema` ({ orgId, instanceId }), `DeprovisionInstanceSchema` ({ orgId, instanceId }).
- [ ] 2.2 Export them from the package index.

## 3. Slug + URL derivation helpers

- [ ] 3.1 Create `packages/api/src/lib/org-slug.ts` with pure `deriveSubdomain(slug, env)` returning `${slug}-${env}`. Validate slug shape `/^[a-z][a-z0-9-]{1,63}$/` defensively; throw `InvalidSlugError` if violated.
- [ ] 3.2 Unit-test in `packages/api/src/lib/__tests__/org-slug.test.ts`: happy path, invalid slug rejects, env enum forced.

## 4. Provisioner interface + mock impl

- [ ] 4.1 Create `packages/api/src/lib/instance-provisioner.ts` exporting `InstanceProvisioner` interface, `ProvisionerError` class, `getProvisioner()` factory keyed on `process.env.INSTANCE_PROVISIONER`.
- [ ] 4.2 Implement `MockProvisioner`: returns deterministic synthetic bearer token (`mock-token-${cuid()}`), `ready: true`, `provisionerInstanceId: mock-${cuid()}`, `baseURL` echoed from input subdomain + `DAEMON_BASE_DOMAIN`. Default selection when env var unset or equals `mock`.
- [ ] 4.3 Factory throws at startup with a clear error pointing at the follow-up spec if `INSTANCE_PROVISIONER` is any value other than `mock` / unset.
- [ ] 4.4 Unit tests in `packages/api/src/lib/__tests__/instance-provisioner.test.ts`: mock impl returns expected shape, factory default selection, factory rejects unknown backend, ProvisionerError serialization preserves structured fields.

## 5. tRPC procedures

- [ ] 5.1 Add `instance.provision` (`ownerAdminProcedure`) in `packages/api/src/routers/instance.ts`: load org by id, assert slug present + shape-valid, check `(orgId, env)` uniqueness via Prisma findFirst (DB unique-index is the hard backstop), derive subdomain + baseURL, INSERT row with `status='PROVISIONING'`, `bearerTokenEnc=encryptToken('PLACEHOLDER')`, `provisioningStartedAt=NOW()`, `env=input.env`, `addedById=ctx.userId`, return `{ id }`. Then fire background `provisionTask(...)` via `void Promise.resolve().then(...)`.
- [ ] 5.2 Implement `provisionTask(prisma, instanceId, args)` in a new file `packages/api/src/lib/provision-task.ts`: call `provisioner.provision`, on success update row (`status=HEALTHY`, real `bearerTokenEnc`, `lastSeenAt`, `provisionerInstanceId`), write audit `instance.provision`. On failure update row (`status=PROVISION_FAILED`), write audit `instance.provisionFailed` with structured error metadata. Never throws to the caller (background fire-and-forget). Plaintext token only lives in scope for the encrypt call — never logged, never put in audit metadata.
- [ ] 5.3 Add `instance.retryProvision` (`ownerAdminProcedure`): load instance, assert `status IN (PROVISIONING, PROVISION_FAILED)` and `env IS NOT NULL`, flip back to `PROVISIONING`, reset `provisioningStartedAt`, fire `provisionTask` again. Idempotent.
- [ ] 5.4 Add `instance.deprovision` (`ownerAdminProcedure`): load instance + include projects (name only), refuse if `projects.length > 0` (BAD_REQUEST with names list — mirror `instance.delete`), refuse if caller is not OWNER (mirror `instance.delete`'s role check), call `provisioner.deprovision()` if `provisionerInstanceId` set, delete DB row, write audit `instance.deprovision`.
- [ ] 5.5 Router tests in `packages/api/src/routers/__tests__/instance.test.ts` (create if missing — mirror `device.test.ts` patterns): happy path provision (mock) → row written `HEALTHY`; collision (orgId+env) → 409 CONFLICT; provisioner throw → `PROVISION_FAILED` + audit row; retryProvision flips failed → provisioning; retryProvision rejected on BYO row (env IS NULL); deprovision blocked by attached projects; deprovision succeeds with zero projects; non-admin caller on provision → FORBIDDEN; non-OWNER caller on deprovision → FORBIDDEN.

## 6. Stuck-row cleanup job

- [ ] 6.1 Create `apps/web/lib/cron/cleanup-failed-provisions.ts` exporting `runCleanupTick(prisma)` that finds `PROVISION_FAILED` rows with `updatedAt < NOW() - 24h`, calls `provisioner.deprovision` best-effort (swallow errors), deletes row in a transaction that re-reads status to avoid racing user retry, writes audit `instance.autoCleanup`.
- [ ] 6.2 Wire into `apps/web/instrumentation.ts` with a `globalThis.__cleanupTickStarted` guard so HMR + multiple workers don't double-fire. `setInterval(runCleanupTick, 60 * 60 * 1000)` plus one immediate tick at startup.
- [ ] 6.3 Unit-test the tick: only deletes rows >24h old, skips if status changed mid-flight (mock the row update between read + delete), calls provisioner.deprovision when provisionerInstanceId set, swallows provisioner errors and still deletes row, leaves recent failed rows untouched.

## 7. Web UI

- [ ] 7.1 Create `apps/web/components/instances/provision-instance-dialog.tsx`: form with `name`, `env` radio, live preview of derived URL `{slug}-{env}.{DAEMON_BASE_DOMAIN}` reading org slug + `NEXT_PUBLIC_DAEMON_BASE_DOMAIN`; on submit calls `trpc.instance.provision.useMutation()`; on success polls `trpc.instance.get` every 2s; shows progress spinner up to 60s; shows retry/deprovision buttons on `PROVISION_FAILED`.
- [ ] 7.2 Update `apps/web/app/[org]/instances/page.tsx` (or equivalent) to surface two side-by-side CTAs: "Provision new daemon" → new dialog; "Add existing daemon" → existing register dialog (unchanged).
- [ ] 7.3 Add a status pill rendering for `PROVISIONING` (animated) and `PROVISION_FAILED` (red with retry link) in the instances list row.
- [ ] 7.4 Wire deprovision action in the row menu (visible only when caller is OWNER and instance was provisioned i.e. `env !== null`). Confirm dialog explicitly states the daemon will be destroyed.

## 8. Docs

- [ ] 8.1 Write `docs/instance-provisioning.md`: the contract layer, mock-only v1 status, env vars, retry semantics, troubleshooting matrix, pointer to the follow-up Ec2ContainerProvisioner spec.
- [ ] 8.2 Write `docs/instance-byo-vs-managed.md`: side-by-side table of when to use `instance.register` vs `instance.provision`, slug immutability note, target audiences (managed-tier vs air-gapped).
- [ ] 8.3 Update root README or `apps/web/README.md` snippet referencing both new docs.

## 9. Verification

- [ ] 9.1 `pnpm --filter @controlai-web/api typecheck` clean.
- [ ] 9.2 `pnpm --filter @controlai-web/api test` — all new tests pass.
- [ ] 9.3 `pnpm --filter @controlai-web/web typecheck` clean.
- [ ] 9.4 `pnpm -r typecheck` and `pnpm -r test` green across monorepo.
- [ ] 9.5 `pnpm openspec validate add-instance-auto-provisioning --strict` green.
- [ ] 9.6 Manual smoke: with `INSTANCE_PROVISIONER=mock`, end-to-end click-through provisions a fake daemon and lands HEALTHY; retry path works; deprovision works; collision returns 409.

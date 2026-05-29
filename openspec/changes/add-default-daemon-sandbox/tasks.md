# Tasks: Default Daemon Sandbox

## 1. Operator manual deployment (one-time)

- [ ] 1.1 Provision single t3.medium EC2 instance in ap-northeast-2 (or desired region).
- [ ] 1.2 Install Caddy reverse proxy via package manager or prebuilt; configure `caddyfile` to listen :443 (TLS), proxy to `localhost:8080`, auto-renew Let's Encrypt certs for `default.daemons.controlai.io`.
- [ ] 1.3 Install `controlai` daemon binary (from `../controlai/deploy/install/install.sh`); configure systemd service `controlai.service` to start on boot, run as `controlai` user.
- [ ] 1.4 Bootstrap factory-qa-unclaimed tenant: call daemon admin API to `POST /v1/tenants/factory-qa-unclaimed/sites` with required fields. Record bearer token in production secret manager.
- [ ] 1.5 Delegate DNS: add `daemons.controlai.io` A-record pointing to EC2 public IP in your DNS registrar (not Route53, as this is bare EC2, not ECS).
- [ ] 1.6 Set production env vars: `DEFAULT_DAEMON_BASE_URL=https://default.daemons.controlai.io`, `DEFAULT_DAEMON_BEARER_TOKEN=<token from 1.4>`.

## 2. Database schema additions

- [ ] 2.1 Add column `ControlaiInstance.legacy Boolean @default(false)`.
- [ ] 2.2 Generate Prisma migration: `pnpm --filter @controlai-web/db migrate dev --name add_legacy_column`.
- [ ] 2.3 Write and run backfill script: `packages/db/backfill/backfill-legacy-instances.ts` sets all existing rows to `legacy=true`.
- [ ] 2.4 Confirm: `pnpm --filter @controlai-web/db migrate reset` (dev) or run migration on staging.

## 3. Device-type manifests (packages/shared-types)

- [ ] 3.1 Create `packages/shared-types/src/device-types/manifests/core/generic-main-gateway.ts`: `id='core-generic-main-gateway'`, `category='gateway'`, display name in Korean + English, port topology (RS-485 x2 for ingest, optional MQTT listen port).
- [ ] 3.2 Create `packages/shared-types/src/device-types/manifests/core/generic-sensor-input.ts`: `id='core-generic-sensor-input'`, `category='sensor'`, defaultSignal with 100-1000 Hz analog range, RS-485 address config, supports noise-meter attachment via `parentDeviceKey`.
- [ ] 3.3 Create `packages/shared-types/src/device-types/manifests/core/generic-tilt-linear.ts`: `id='core-generic-tilt-linear'`, `category='sensor'`, defaultSignal with ±180° range, config field `chainLength` (1-16, default 4).
- [ ] 3.4 Create `packages/shared-types/src/device-types/manifests/core/generic-vibration-tilt-standalone.ts`: `id='core-generic-vibration-tilt-standalone'`, `category='sensor'`, defaultSignal with acceleration + tilt combo, no chaining.
- [ ] 3.5 Create `packages/shared-types/src/device-types/manifests/core/generic-control-485x2.ts`: `id='core-generic-control-485x2'`, `category='sensor'`, two RS-485 child slots.
- [ ] 3.6 Create `packages/shared-types/src/device-types/manifests/core/generic-vibrating-wire-sensor.ts`: `id='core-generic-vibrating-wire-sensor'`, `category='sensor'`, defaultSignal for resonance frequency + damping.
- [ ] 3.7 Create `packages/shared-types/src/device-types/manifests/core/generic-noise-meter.ts`: `id='core-generic-noise-meter'`, `category='sensor'`, **attached child only** (cannot be dropped standalone; must set `Device.parentDeviceKey` to a sensor-input node). No RS-485 connection; noise sensor wired directly to parent.
- [ ] 3.8 Wire all 7 manifests into `packages/shared-types/src/device-types/index.ts` (import + `registerDeviceType`).
- [ ] 3.9 Update connection rules in `@controlai-web/shared-types`: add constraints that `generic-noise-meter` can only parent under `generic-sensor-input`; `generic-tilt-linear` supports chaining (self-parent).
- [ ] 3.10 Write tests: `packages/shared-types/src/__tests__/device-types-new-manifests.test.ts` — assert all 7 load, `assertKnownDeviceType` finds them, `validateConnection` enforces attachment/chaining rules.
- [ ] 3.11 Run `pnpm --filter @controlai-web/shared-types test -- device-types-new` → GREEN.
- [ ] 3.12 Run `pnpm -r typecheck` → GREEN (no TS errors from new manifests).

## 4. Synthetic signal generators (apps/simulator, TDD-first)

- [ ] 4.1 Write tests FIRST in `apps/simulator/src/__tests__/typed-generators.test.ts` (6 scenarios):
  - 4.1.1 `TiltGenerator` with `chainLength=2` emits 2 signals per tick, each ±bounded degrees with slow drift.
  - 4.1.2 `VibrationGenerator` emits sinusoidal acceleration centered ~0g with configurable amplitude.
  - 4.1.3 `CrackEncoderGenerator` emits sparse burst events (Poisson distribution) with encoder position.
  - 4.1.4 `NoiseMeterGenerator` emits dBA envelope curves (30-90 dB range) with realistic quietness/loudness patterns.
  - 4.1.5 `VibratingWireGenerator` emits resonance frequency + damping ratio (0-300 Hz) with environmental drift.
  - 4.1.6 `SensorConfig` discriminator by `pattern` field (`'tilt'|'vibration'|'crack-encoder'|'noise-meter'|'vibrating-wire'|'random-walk'`) parses pattern-specific params correctly.
- [ ] 4.2 Confirm tests RED: `pnpm --filter ./apps/simulator test -- typed-generators`.
- [ ] 4.3 Implement generator classes in `apps/simulator/src/generators/` (new file):
  - 4.3.1 Export `TiltGenerator`, `VibrationGenerator`, `CrackEncoderGenerator`, `NoiseMeterGenerator`, `VibratingWireGenerator` (each ~50 LOC).
  - 4.3.2 Each class: constructor takes `SensorConfig`, exposes `next(): SignalValue` method.
  - 4.3.3 Math models per research doc §3 (bounded random walks, sinusoids, Poisson bursts, etc.).
- [ ] 4.4 Extend `SensorConfig` type: add `pattern?: 'tilt'|'vibration'|'crack-encoder'|'noise-meter'|'vibrating-wire'|'random-walk'` discriminator + pattern-specific fields (e.g., `tiltDriftRate`, `vibrationAmplitude`, etc.).
- [ ] 4.5 Wire into `apps/simulator/src/manager.ts`: for each simulated gateway, instantiate appropriate generator based on node's `deviceTypeId` or explicit pattern config; call `next()` per tick.
- [ ] 4.6 Run tests: `pnpm --filter ./apps/simulator test -- typed-generators` → GREEN.

## 5. ControlaiInstance bootstrap and UI changes

- [ ] 5.1 Create tRPC procedure `instance.bootstrapDefault`: takes `orgId`, returns `{ instanceId, baseURL, status }` or throws if env vars missing. Idempotent: if row already exists, return existing row.
- [ ] 5.2 Write tests: `packages/api/src/routers/__tests__/instance.test.ts` (add new test suite):
  - 5.2.1 `bootstrapDefault` creates row when none exists.
  - 5.2.2 `bootstrapDefault` returns existing row on second call (idempotent).
  - 5.2.3 `bootstrapDefault` throws if `DEFAULT_DAEMON_BASE_URL` env var missing.
  - 5.2.4 `bootstrapDefault` throws if `DEFAULT_DAEMON_BEARER_TOKEN` missing.
- [ ] 5.3 Find and wire `better-auth` org.created hook (search in `packages/api/src/auth/` or `apps/web/lib/auth/`): call `instance.bootstrapDefault(orgId)` synchronously after org creation. Swallow errors gracefully (log + continue; org creation succeeds even if bootstrap fails).
- [ ] 5.4 Write test for org.created hook: mock org creation, assert bootstrap is called.
- [ ] 5.5 Write and run backfill script: `packages/api/src/scripts/backfill-default-instances.ts` — for all existing orgs without a default daemon row, call `bootstrapDefault`. Log results.
- [ ] 5.6 Modify `/apps/web/app/(app)/orgs/[orgId]/instances/page.tsx`:
  - 5.6.1 Query instances with filter `{ legacy: false }` instead of all.
  - 5.6.2 When default daemon exists, hide "Create instance" button and show health status pill (last-seen, status badge).
  - 5.6.3 Show mock instances separately with deprecation notice.
- [ ] 5.7 Update related queries/lists: anywhere instances are listed, filter `legacy=false` by default; add optional `includeLegacy` flag for admin views.
- [ ] 5.8 Tests: `apps/web/__tests__/instances-page.test.tsx` (verify button hidden, health pill renders).

## 6. Canvas visual and config extensions

- [ ] 6.1 Extend `apps/web/components/canvas/nodes/device-node.tsx`:
  - 6.1.1 Add dashed border (CSS) when `registrationState='UNREGISTERED'`; solid border when `'REGISTERED'`.
  - 6.1.2 Add ghost/faded icon visual when unregistered.
- [ ] 6.2 Create inline sparkline component `apps/web/components/canvas/nodes/node-sparkline.tsx`:
  - 6.2.1 Renders 30-second rolling history as small line chart (recharts or custom canvas).
  - 6.2.2 Reads telemetry from canvas store: `store.nodeDevices[canvasNodeId].telemetry` (to be added).
  - 6.2.3 Updates on SSE telemetry tick (reuse existing SSE connection).
- [ ] 6.3 Extend node-config-dialog to add synthetic config fields:
  - 6.3.1 New section: "Synthetic Signal Config" (show only for `registrationState='UNREGISTERED'`).
  - 6.3.2 Fields: `intervalMs` (input, default 1000), `valueMin` (input), `valueMax` (input).
  - 6.3.3 Fields: `brokerKind` (dropdown: 'mosquitto' | 'EMQX', inherited from Site), `retentionDays` (number, default 7, inherited from Site).
  - 6.3.4 Validation: intervalMs ≥ 100, valueMin < valueMax.
  - 6.3.5 Save config via `device.update { config: { intervalMs, valueMin, valueMax } }`.
- [ ] 6.4 Update `apps/web/stores/canvas-store.ts`:
  - 6.4.1 Add `telemetry: SignalValue[]` field to `DeviceRow` (rolling 30s history).
  - 6.4.2 Add action `updateNodeTelemetry(canvasNodeId, value)` — appends to rolling array, evicts oldest.
- [ ] 6.5 Tests: `apps/web/components/canvas/__tests__/device-node.spec.tsx` (dashed/solid rendering), `__tests__/node-config-dialog.spec.tsx` (config fields appear).

## 7. Apply pipeline extensions (TDD)

- [ ] 7.1 Write tests FIRST in `packages/api/src/routers/__tests__/apply.test.ts` (add new suite):
  - 7.1.1 Plan op `setBrokerKind` serializes `Site.brokerKind` update.
  - 7.1.2 Plan op `setRetentionDays` serializes `Site.retentionDeriod` update.
  - 7.1.3 Preview shows diffs for all 3 new ops (broker-kind, retention, config changes).
  - 7.1.4 Commit executes new ops in correct sequence (Site updates before device bindings).
  - 7.1.5 Idempotent: second apply with same canvas → plan hash unchanged, no-op commit.
- [ ] 7.2 Confirm tests RED: `pnpm --filter @controlai-web/api test -- apply`.
- [ ] 7.3 Extend `packages/api/src/lib/apply-planner.ts`:
  - 7.3.1 Add plan op types `setBrokerKind`, `setRetentionDays`, `setIngestMode`.
  - 7.3.2 Synthesize these ops when canvas Site node's `data` fields differ from current DB.
  - 7.3.3 Order ops: Site CRUD → broker config → device bindings.
- [ ] 7.4 Extend `packages/api/src/lib/apply-executor.ts`:
  - 7.4.1 Implement op handlers for the 3 new ops: call daemon REST `PATCH /v1/tenants/{tid}/sites/{sid}` with broker/retention payload.
  - 7.4.2 Handle 409 idempotent updates.
- [ ] 7.5 Update `apps/web/components/canvas/apply-modal.tsx`:
  - 7.5.1 Render new op types in preview list (broker-kind, retention, etc.) with human-readable labels.
- [ ] 7.6 Tests GREEN: `pnpm --filter @controlai-web/api test -- apply` + `pnpm --filter ./apps/web test -- apply-modal`.
- [x] 7.7 Auto-create gateway rows from canvas gateway nodes.

## 8. Admin unclaimed-boards route

- [ ] 8.1 Create new route `apps/web/app/(app)/admin/unclaimed-boards/page.tsx`:
  - 8.1.1 Auth guard: reject non-ORG_ADMIN users with 403 (use `requireRole` from auth middleware).
  - 8.1.2 Fetch org's unclaimed boards from the default daemon's `factory-qa-unclaimed` tenant.
- [ ] 8.2 Create tRPC procedure `admin.unclaimedBoards.list({ orgId })`:
  - 8.2.1 Auth guard: ORG_ADMIN+.
  - 8.2.2 Call default daemon REST: `GET /v1/tenants/factory-qa-unclaimed/sites` (or equivalent endpoint listing devices).
  - 8.2.3 Return array of `{ realUuid, lastSeenAt, lastSignalPreview }`.
- [ ] 8.3 UI render unclaimed boards as filterable table (Device ID, Last Seen, Last Signal).
- [ ] 8.4 Tests: `packages/api/src/routers/__tests__/admin.test.ts` — auth guard rejects non-admin, query shape.

## 9. Environment variable bootstrap

- [ ] 9.1 Update `apps/web/.env.example`: add `DEFAULT_DAEMON_BASE_URL=https://default.daemons.controlai.io`, `DEFAULT_DAEMON_BEARER_TOKEN=<encrypted-token>`.
- [ ] 9.2 Set dev .env.local: `DEFAULT_DAEMON_BASE_URL=http://localhost:8080` (if local daemon running), or point to staging.
- [ ] 9.3 Update `docs/` README section on environment setup to explain the two new vars.

## 10. Documentation

- [ ] 10.1 Create `docs/default-daemon-deployment.md`: AWS account setup is NOT required. Write: one-time EC2 t3.medium setup, Caddy config, systemd service, DNS delegation, factory-qa-unclaimed bootstrap, health checks. Include mermaid flow diagram from design.md.
- [ ] 10.2 Update `docs/instance-provisioning.md`: add section "Default Daemon (Sandbox)" describing multi-org tenancy, reset semantics, synthetic signals, broker/TSDB config from canvas.
- [ ] 10.3 Create `docs/admin-unclaimed-boards.md`: how to view factory boards landing in unclaimed tenant; future claim flow (deferred).
- [ ] 10.4 Update `docs/instance-byo-vs-managed.md`: add row for Sandbox tier (free, shared, default daemon, synthetic signals, per-org reset).

## 11. Verification and validation

- [ ] 11.1 `pnpm --filter @controlai-web/api typecheck` → GREEN.
- [ ] 11.2 `pnpm --filter @controlai-web/api test` → all existing + new tests GREEN.
- [ ] 11.3 `pnpm --filter ./apps/web typecheck` → GREEN.
- [ ] 11.4 `pnpm --filter ./apps/web test` → all existing + new tests GREEN.
- [ ] 11.5 `pnpm --filter ./apps/simulator typecheck` → GREEN.
- [ ] 11.6 `pnpm --filter ./apps/simulator test` → all existing + new generators tests GREEN.
- [ ] 11.7 `pnpm --filter @controlai-web/shared-types typecheck` → GREEN.
- [ ] 11.8 `pnpm --filter @controlai-web/shared-types test` → device-types manifest tests GREEN.
- [ ] 11.9 `pnpm -r typecheck && pnpm -r test` → monorepo-wide GREEN.
- [ ] 11.10 **OPERATOR MANUAL SMOKE TEST**: In a staging/QA org, bootstrap default daemon (step 1), drop main-gateway + 3 sensor-input nodes on canvas, add noise-meter as child, configure broker='mosquitto', retention=7 days, Apply → preview shows 5+ ops → commit → verify daemon state via `curl https://default.daemons.controlai.io/v1/tenants/{orgId}` → assert signals appear in sparklines within 10s → PASS.

## 12. Post-merge tasks (deferred)

## 13. Phase E: Serial provisioning

- [x] 13.1 Document line-oriented Web Serial provisioning protocol.
- [x] 13.2 Add `gateway.getProvisioningPayload` and `gateway.byCanvasNode` tRPC procedures.
- [x] 13.3 Implement browser serial wrapper and connect dialog flow.
- [x] 13.4 Add "Connect via Serial" actions on gateway canvas node and devices list.

- [ ] 12.1 Create follow-up spec: `add-board-claim-flow` (users claim unclaimed boards → OTA push cert/URL/group_id).
- [ ] 12.2 Create follow-up spec: `add-managed-tier-container-mode` in `../controlai` (daemon containerization for per-org ECS provisioning).
- [ ] 12.3 Create follow-up spec: `add-advanced-tsdb-config` (per-tenant retention enforcement, compression policies).
- [ ] 12.4 Create follow-up spec: `add-default-daemon-ha` (multi-AZ, failover, load balancing for default daemon).
- [ ] 12.5 Archive spec: `add-ec2-container-provisioner` (code stays; marked as deferred pending daemon-containerization).

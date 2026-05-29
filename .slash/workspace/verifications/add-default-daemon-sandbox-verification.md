## Test Report: add-default-daemon-sandbox

### Summary
- **Status**: FAIL
- **Tests**: 10 automated, 0 manual
- **Environment**: macOS darwin, Node v22.22.0, pnpm 9.15.0

### Success Criteria
| # | Criteria | Status | Evidence |
|---|----------|--------|----------|
| 1 | t11.1 API typecheck command executed and must be GREEN | ✅ | `pnpm --filter @controlai-web/api typecheck` exited 0. |
| 2 | t11.2 API test command executed and must be GREEN | ✅ | `pnpm --filter @controlai-web/api test` exited 0; 25 files / 217 tests passed. |
| 3 | t11.3 Web typecheck command executed and must be GREEN | ❌ | `pnpm --filter ./apps/web typecheck` exited 2 with TS2589 at `app/(app)/orgs/[orgId]/projects/page.tsx:104`. |
| 4 | t11.4 Web test command executed and must be GREEN | ❌ | `pnpm --filter ./apps/web test` exited 1; 4 files failed, including `__tests__/instances-page.test.tsx`. |
| 5 | t11.5 Simulator typecheck command executed and must be GREEN | ✅ | `pnpm --filter ./apps/simulator typecheck` exited 0. |
| 6 | t11.6 Simulator test command executed and must be GREEN | ✅ | `pnpm --filter ./apps/simulator test` exited 0; `typed-generators.test.ts` passed. |
| 7 | t11.7 Shared-types typecheck command executed and must be GREEN | ✅ | `pnpm --filter @controlai-web/shared-types typecheck` exited 0. |
| 8 | t11.8 Shared-types test command executed and must be GREEN | ✅ | `pnpm --filter @controlai-web/shared-types test` exited 0; `device-types-new-manifests.test.ts` passed. |
| 9 | t11.9 Monorepo recursive typecheck and test executed and must both be GREEN | ❌ | `pnpm -r typecheck` exited 1 and `pnpm -r test` exited 1. |

### Manual Verification
- No browser/manual verification was performed because the requested scope was command-only monorepo verification.
- Commands were executed in the exact order requested; no command was skipped after failures.

### Command Summary
| Command | Exit | Status | Notes |
|---|---:|---|---|
| `pnpm --filter @controlai-web/shared-types typecheck` | 0 | GREEN | GREEN; t11.7 satisfied. |
| `pnpm --filter @controlai-web/shared-types test` | 0 | GREEN | GREEN; includes src/__tests__/device-types-new-manifests.test.ts. |
| `pnpm --filter @controlai-web/api typecheck` | 0 | GREEN | GREEN; t11.1 satisfied. |
| `pnpm --filter @controlai-web/api test` | 0 | GREEN | GREEN; t11.2 satisfied, but emits non-fatal provision-progress stderr warnings. |
| `pnpm --filter ./apps/simulator typecheck` | 0 | GREEN | GREEN; t11.5 satisfied. |
| `pnpm --filter ./apps/simulator test` | 0 | GREEN | GREEN; typed-generators.test.ts passed. |
| `pnpm --filter ./apps/web typecheck` | 2 | RED | RED; blocked by pre-existing TS2589 in app/(app)/orgs/[orgId]/projects/page.tsx:104. |
| `pnpm --filter ./apps/web test` | 1 | RED | RED; related regressions in instances-page/canvas tests plus selector ambiguity. |
| `pnpm -r typecheck` | 1 | RED | RED; fails only when apps/web typecheck reaches the pre-existing TS2589 error. |
| `pnpm -r test` | 1 | RED | RED; blocked by the same related apps/web test regressions. |

### Command 1: `pnpm --filter @controlai-web/shared-types typecheck`
- **Exit code**: 0 (GREEN)
- **Assessment**: PRE-EXISTING or outside the explicitly shipped files in the execution context
- **Log excerpt**:
```text

> @controlai-web/shared-types@0.1.0 typecheck /Users/8bitnyan/Documents/ThinkTank/controlai-web/packages/shared-types
> tsc --noEmit

```

### Command 2: `pnpm --filter @controlai-web/shared-types test`
- **Exit code**: 0 (GREEN)
- **Assessment**: PRE-EXISTING or outside the explicitly shipped files in the execution context
- **Log excerpt**:
```text
 ✓ src/device-types/__tests__/manifests/daejak.spec.ts (2 tests) 109ms
 ✓ src/device-types/__tests__/manifests/core.spec.ts (6 tests) 178ms
 ✓ src/device-types/__tests__/aggregator.spec.ts (1 test) 174ms
 ✓ src/__tests__/device-types-new-manifests.test.ts (3 tests) 2ms
 ✓ src/device-types/__tests__/port-types.spec.ts (1 test) 1ms

 Test Files  12 passed (12)
      Tests  74 passed (74)
   Start at  12:23:31
   Duration  483ms (transform 379ms, setup 0ms, collect 687ms, tests 525ms, environment 1ms, prepare 939ms)

[33mThe CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.[39m
```

### Command 3: `pnpm --filter @controlai-web/api typecheck`
- **Exit code**: 0 (GREEN)
- **Assessment**: PRE-EXISTING or outside the explicitly shipped files in the execution context
- **Log excerpt**:
```text

> @controlai-web/api@0.1.0 typecheck /Users/8bitnyan/Documents/ThinkTank/controlai-web/packages/api
> tsc --noEmit

```

### Command 4: `pnpm --filter @controlai-web/api test`
- **Exit code**: 0 (GREEN)
- **Assessment**: GREEN with warnings: tests passed; the stderr warnings reference API files in this change area but did not fail the command.
- **Log excerpt**:
```text
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
[provision-progress] update failed (non-fatal) TypeError: prisma.controlaiInstance.findUnique is not a function
    at Module.updateProvisionProgress (/Users/8bitnyan/Documents/ThinkTank/controlai-web/packages/api/src/lib/provision-progress.ts:14:48)
    at /Users/8bitnyan/Documents/ThinkTank/controlai-web/packages/api/src/lib/provision-task.ts:73:13
    at processTicksAndRejections (node:internal/process/task_queues:105:5)

stderr | src/__tests__/crypto.test.ts > crypto — AES-256-GCM token encryption > throws when INSTANCE_TOKEN_KEY is missing
INSTANCE_TOKEN_KEY is required

stderr | src/routers/__tests__/admin.test.ts
[stream] STREAM_JWT_SECRET is not set — stream.token will fail at runtime. Set this env var before going to production.

```

### Command 5: `pnpm --filter ./apps/simulator typecheck`
- **Exit code**: 0 (GREEN)
- **Assessment**: PRE-EXISTING or outside the explicitly shipped files in the execution context
- **Log excerpt**:
```text

> @controlai-web/simulator@0.1.0 typecheck /Users/8bitnyan/Documents/ThinkTank/controlai-web/apps/simulator
> tsc --noEmit

```

### Command 6: `pnpm --filter ./apps/simulator test`
- **Exit code**: 0 (GREEN)
- **Assessment**: PRE-EXISTING or outside the explicitly shipped files in the execution context
- **Log excerpt**:
```text
 RUN  v2.1.9 /Users/8bitnyan/Documents/ThinkTank/controlai-web/apps/simulator

 ✓ src/__tests__/lifecycle-listener.test.ts (4 tests) 4ms
 ✓ src/__tests__/typed-generators.test.ts (6 tests) 3ms
 ✓ src/__tests__/manager.test.ts (7 tests) 3ms
 ✓ src/__tests__/sitegroup-simulation.test.ts (3 tests) 6ms

 Test Files  4 passed (4)
      Tests  20 passed (20)
   Start at  12:23:38
   Duration  490ms (transform 162ms, setup 0ms, collect 620ms, tests 15ms, environment 0ms, prepare 181ms)

```

### Command 7: `pnpm --filter ./apps/web typecheck`
- **Exit code**: 2 (RED)
- **Assessment**: PRE-EXISTING: this hits apps/web/app/(app)/orgs/[orgId]/projects/page.tsx, which is outside the shipped files listed in the execution context.
- **First failing file**: `apps/web/app/(app)/orgs/[orgId]/projects/page.tsx:104`
- **First error message**: `error TS2589: Type instantiation is excessively deep and possibly infinite.`
- **Last 15 lines**:
```text

> web@0.1.0 typecheck /Users/8bitnyan/Documents/ThinkTank/controlai-web/apps/web
> tsc --noEmit

app/(app)/orgs/[orgId]/projects/page.tsx(104,20): error TS2589: Type instantiation is excessively deep and possibly infinite.
/Users/8bitnyan/Documents/ThinkTank/controlai-web/apps/web:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  web@0.1.0 typecheck: `tsc --noEmit`
Exit status 2
```

### Command 8: `pnpm --filter ./apps/web test`
- **Exit code**: 1 (RED)
- **Assessment**: RELATED: the failing suite covers apps/web/stores/canvas-store.ts and apps/web/__tests__/instances-page.test.tsx, both part of the shipped web scope for this change.
- **First failing file**: `apps/web/stores/__tests__/canvas-store.test.ts`
- **First error message**: `expected { deviceKey: 'dev_1', …(6) } to deeply equal { deviceKey: 'dev_1', …(5) }`
- **Last 15 lines**:
```text
          [33mclass[39m=[32m"text-[10px] text-muted-foreground"[39m
        [36m>[39m
          ...
 ❯ waitForWrapper ../../node_modules/.pnpm/@testing-library+dom@10.4.1/node_modules/@testing-library/dom/dist/wait-for.js:163:27
 ❯ ../../node_modules/.pnpm/@testing-library+dom@10.4.1/node_modules/@testing-library/dom/dist/query-helpers.js:86:33
 ❯ components/canvas/__tests__/orphan-node.spec.tsx:41:34
     39|   it('selecting a manifest calls store.replaceDeviceType', async () =>…
     40|     render(<MigrateDeviceTypeDialog open onClose={() => {}} nodeId="n1…
     41|     fireEvent.click(await screen.findByRole('button', { name: /Generic…
       |                                  ^
     42|     await waitFor(() => {
     43|       expect(replaceDeviceType).toHaveBeenCalledWith('n1', 'core-gener…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/4]⎯

```

### Command 9: `pnpm -r typecheck`
- **Exit code**: 1 (RED)
- **Assessment**: PRE-EXISTING: the recursive run only fails after reaching the same unrelated apps/web/projects page TS2589 error.
- **First failing file**: `apps/web/app/(app)/orgs/[orgId]/projects/page.tsx:104`
- **First error message**: `error TS2589: Type instantiation is excessively deep and possibly infinite.`
- **Last 15 lines**:
```text
packages/infra typecheck: Done
apps/mqtt-bridge typecheck$ tsc --noEmit
apps/simulator typecheck$ tsc --noEmit
packages/runtime-drivers typecheck$ tsc --noEmit
apps/mqtt-bridge typecheck: Done
packages/runtime-drivers typecheck: Done
apps/simulator typecheck: Done
packages/api typecheck$ tsc --noEmit
packages/api typecheck: Done
apps/web typecheck$ tsc --noEmit
apps/web typecheck: app/(app)/orgs/[orgId]/projects/page.tsx(104,20): error TS2589: Type instantiation is excessively deep and possibly infinite.
apps/web typecheck: Failed
/Users/8bitnyan/Documents/ThinkTank/controlai-web/apps/web:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  web@0.1.0 typecheck: `tsc --noEmit`
Exit status 1
```

### Command 10: `pnpm -r test`
- **Exit code**: 1 (RED)
- **Assessment**: RELATED: the recursive test run is blocked by the same shipped-scope web regressions seen in apps/web test.
- **First failing file**: `apps/web/stores/__tests__/canvas-store.test.ts`
- **First error message**: `expected { deviceKey: 'dev_1', …(6) } to deeply equal { deviceKey: 'dev_1', …(5) }`
- **Last 15 lines**:
```text
apps/web test:      39|   it('selecting a manifest calls store.replaceDeviceType', async () =>…
apps/web test:      40|     render(<MigrateDeviceTypeDialog open onClose={() => {}} nodeId="n1…
apps/web test:      41|     fireEvent.click(await screen.findByRole('button', { name: /Generic…
apps/web test:        |                                  ^
apps/web test:      42|     await waitFor(() => {
apps/web test:      43|       expect(replaceDeviceType).toHaveBeenCalledWith('n1', 'core-gener…
apps/web test: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/4]⎯
apps/web test:  Test Files  4 failed | 13 passed (17)
apps/web test:       Tests  4 failed | 78 passed (82)
apps/web test:    Start at  12:23:58
apps/web test:    Duration  3.26s (transform 746ms, setup 3.43s, collect 2.86s, tests 1.55s, environment 8.36s, prepare 1.11s)
apps/web test: Failed
/Users/8bitnyan/Documents/ThinkTank/controlai-web/apps/web:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  web@0.1.0 test: `vitest run`
Exit status 1
```

### Code Quality Review
- **Dead code**: No dead-code-only blocker was validated by execution, but the failing `apps/web/__tests__/instances-page.test.tsx:1-24` test never reaches its assertions because JSX renders without a React import in this test harness.
- **Defensive workarounds**: `apps/web/stores/canvas-store.ts:410-429` normalizes missing `telemetry` to `[]`; the new shape is reasonable, but it now diverges from the expectations in `apps/web/stores/__tests__/canvas-store.test.ts:19-24`, which caused a failing deep-equality check.
- **Self-documenting**: `apps/web/components/canvas/__tests__/node-palette.spec.tsx:29-33` and `apps/web/components/canvas/__tests__/orphan-node.spec.tsx:39-43` use broad `/Generic Sensor/i` queries that are no longer self-explanatory once multiple similarly named manifests exist.
- **TODO debt**: No `TODO`-driven blocker was surfaced in the executed outputs reviewed here.
- **Extensibility**: `apps/web/app/(app)/orgs/[orgId]/projects/page.tsx:104` still trips TS2589 under typecheck, suggesting the current typed rendering path is brittle and blocks unrelated changes at the workspace level.
- **Convention consistency**: Most React test files in the failing area import React explicitly (`node-palette.spec.tsx`, `orphan-node.spec.tsx`), while `apps/web/__tests__/instances-page.test.tsx` does not; the runtime failure shows that this file is inconsistent with the current test setup.
- **Improvements**:
  - `apps/web/__tests__/instances-page.test.tsx:1-24` — align JSX runtime/import convention so the test can render before asserting the new health pill behavior.
  - `apps/web/stores/__tests__/canvas-store.test.ts:19-24` or `apps/web/stores/canvas-store.ts:410-429` — make the stored `DeviceRow` shape and the test expectation agree on `telemetry` defaults.
  - `apps/web/components/canvas/__tests__/node-palette.spec.tsx:29-33` and `apps/web/components/canvas/__tests__/orphan-node.spec.tsx:39-43` — switch to a more specific accessible name or manifest id so new manifests do not create ambiguous queries.
  - `apps/web/app/(app)/orgs/[orgId]/projects/page.tsx:104` — simplify or narrow the mapped `instances` type so `tsc --noEmit` can complete again.

### Issues Found
- **Severity: HIGH**
  - Steps to reproduce: Run `pnpm --filter ./apps/web typecheck`.
  - Observed: `app/(app)/orgs/[orgId]/projects/page.tsx(104,20): error TS2589: Type instantiation is excessively deep and possibly infinite.`
  - Suggested fix: Simplify or explicitly narrow the `instances?.map(...)` typing path around `apps/web/app/(app)/orgs/[orgId]/projects/page.tsx:104`.
- **Severity: HIGH**
  - Steps to reproduce: Run `pnpm --filter ./apps/web test`.
  - Observed: `apps/web/__tests__/instances-page.test.tsx` fails with `React is not defined`, so the new instances-page verification does not execute successfully.
  - Suggested fix: Make the test use the JSX runtime/import convention expected by this Vitest setup.
- **Severity: MEDIUM**
  - Steps to reproduce: Run `pnpm --filter ./apps/web test`.
  - Observed: `apps/web/stores/__tests__/canvas-store.test.ts` fails because stored node-device rows now include one extra property (`telemetry`).
  - Suggested fix: Update either the test expectation or the store contract so both agree on the normalized shape.
- **Severity: MEDIUM**
  - Steps to reproduce: Run `pnpm --filter ./apps/web test`.
  - Observed: `node-palette.spec.tsx` and `orphan-node.spec.tsx` both fail because `/Generic Sensor/i` now matches multiple manifest names after the new device manifests landed.
  - Suggested fix: Use a specific accessible name or manifest id in those queries.

### OpenSpec Tasks
| Task | Verified | Recommendation |
|------|----------|----------------|
| 11.1 `pnpm --filter @controlai-web/api typecheck` | Yes | Mark [x] |
| 11.2 `pnpm --filter @controlai-web/api test` | Yes | Mark [x] |
| 11.3 `pnpm --filter ./apps/web typecheck` | No | Keep [ ] |
| 11.4 `pnpm --filter ./apps/web test` | No | Keep [ ] |
| 11.5 `pnpm --filter ./apps/simulator typecheck` | Yes | Mark [x] |
| 11.6 `pnpm --filter ./apps/simulator test` | Yes | Mark [x] |
| 11.7 `pnpm --filter @controlai-web/shared-types typecheck` | Yes | Mark [x] |
| 11.8 `pnpm --filter @controlai-web/shared-types test` | Yes | Mark [x] |
| 11.9 `pnpm -r typecheck && pnpm -r test` | No | Keep [ ] |

## Broker provisioning gaps closed

- Code changes in `../controlai`:
  - `79ad37c` `bootstrap(traefik): add :8883 mqtt entrypoint for per-site TLS passthrough`
  - `7d0e0f0` `daemon(networks): ensure controlai-edge + per-tenant docker networks at startup`
  - `internal/runner/docker.go` now uses Docker SDK `NetworkList` then `NetworkCreate(Driver: bridge)`; duplicate-name race is treated idempotently.
  - Daemon startup (`cmd/controlai/main.go`) ensures `controlai-edge` and existing `<tenant>-net` networks.
  - Tenant creation (`internal/daemon/server.go`) now uses SDK-backed network ensure instead of shelling out `docker network create`.

- Manual deployment performed:
  - Cross-compiled and deployed `/tmp/controlai-linux-amd64` to EC2 `43.203.6.179` as `/usr/local/bin/controlai`.
  - Restarted `controlai` service and confirmed clean startup logs (`daemon ready`, listeners up, reconciler started).
  - Checked live `/etc/traefik/traefik.yml`; it already contained `entryPoints.mqtt.address: :8883`, so no manual patch was required.

- Verification outputs:
  - `nc -zv 43.203.6.179 8883` => `succeeded`.
  - `docker ps` shows broker/ingest/tsdb containers present for `tnt_factory-qa-unclaimed` + `ste_s327...` site, but currently in `Restarting` state (not healthy/running yet).
  - Simulator PTY (`pty_8cf38028`) still logs `Gateway error ... ECONNREFUSED 43.203.6.179:8883` for gateway `cmpqkjw5c000fowpfleb35xzd`; `SIM_TLS_INSECURE=true` is already enabled.
  - Residual gap: broker containers are flapping, so data-plane connectivity remains unstable despite port/path bootstrap being fixed.

## Broker provisioning fixed

- Fixed daemon host bootstrap gaps in `controlai` repo:
  - Ensured `/home/controlai/.docker` exists with `controlai:controlai` ownership.
  - Set systemd runtime env `HOME=/home/controlai` for docker compose execution.
  - Added ingest image bootstrap build (`controlai-ingest:latest`) before daemon startup.
- Live EC2 remediation executed for instance `i-013b7248f910c08ee`:
  - Created home directory structure and ownership.
  - Built ingest image on-host.
  - Restarted `controlai` service to trigger immediate reconciler converge.

### Action items for mad-agent
- Fix the related `apps/web` test regressions before re-running verification:
  - `apps/web/__tests__/instances-page.test.tsx` currently throws `React is not defined`.
  - `apps/web/stores/__tests__/canvas-store.test.ts` no longer matches the stored `DeviceRow` shape after telemetry defaults are added.
  - `apps/web/components/canvas/__tests__/node-palette.spec.tsx` and `apps/web/components/canvas/__tests__/orphan-node.spec.tsx` use broad `/Generic Sensor/i` queries that now match multiple manifests.

### Final Status
**Overall: FAIL**
**Recommendation**: Fix the related `apps/web` test regressions, then re-run the full 10-command verification set; separately track the pre-existing `apps/web` TS2589 typecheck blocker because it still prevents t11.3 and t11.9 from going green.

## Phase B: Serial provisioning

- Added protocol spec: `docs/serial-provisioning-protocol.md`.
- Added API procedures in `packages/api/src/routers/gateway.ts`: `gateway.byCanvasNode`, `gateway.getProvisioningPayload` (lazy mint when PEMs missing).
- Added Web Serial wrapper: `apps/web/lib/serial-provisioning.ts` and ambient types `apps/web/types/web-serial.d.ts`.
- Added UI dialog: `apps/web/components/devices/connect-serial-dialog.tsx`.
- Added entry-point buttons:
  - Canvas gateway node: `apps/web/components/canvas/nodes/device-node.tsx`
  - Devices list row action: `apps/web/components/devices/devices-client.tsx`
- Added test files:
  - `apps/web/__tests__/serial-provisioning.test.ts`
  - `packages/api/src/__tests__/gateway-get-provisioning-payload.test.ts`

Manual test steps:
1. Open a site-group canvas with a gateway node.
2. Click USB button on gateway node (or `Connect` in devices list).
3. In Chrome/Edge HTTPS or localhost, click Start provisioning.
4. Verify steps progress: request port → read info → mint cert → write config → reboot.
5. For unsupported browsers, verify fallback message and JSON copy action.
### Follow-up: Gateway auto-create
- Added `Gateway.canvasNodeId` with unique key `@@unique([siteGroupId, canvasNodeId])` and migration `20260529160000_add_gateway_canvas_node_id`.
- Extended `OpResult` to include `daemonResponseBody` and now stamp success daemon payload snippets (2KB-clamped).
- `apply.commit` now logs unresolved `createSite` IDs, wraps Site upsert in try/catch, and propagates structured op failure details.
- Added gateway auto-create/update in apply flow from canvas gateway nodes with defaults (`kind=simulator`, `mode=cbor-modules-cloud`, `desiredState=running`).
- IssueCert response is now reused to populate encrypted Site/Gateway cert materials for simulator preview flow.

## G1+G2+G3 complete (infra follow-up)

- G1 Traefik MQTT entrypoint validated live on EC2 (`/etc/traefik/traefik.yml`) and Traefik restarted.
- G2 Docker network bootstrap added in daemon startup (`controlai-edge` + `<tenant>-net`) and tenant-create best-effort network ensure.
- G3 Linux/amd64 daemon cross-compiled, deployed, installed to `/usr/local/bin/controlai`, and systemd restarted.

### Re-run commands

```bash
nc -zv 43.203.6.179 8883
ssh -i ~/.ssh/controlai-controlai-default.pem ubuntu@43.203.6.179 'sudo docker ps --format "{{.Names}} {{.Image}} {{.Status}}"'
ssh -i ~/.ssh/controlai-controlai-default.pem ubuntu@43.203.6.179 'sudo journalctl -u controlai -n 200 --no-pager'
curl -s http://localhost:4001/gateways/cmpqjojp80001tpxhwxq12upu/status
```

### Current status snapshot

- `nc -zv 43.203.6.179 8883` → **succeeds**.
- Daemon no longer emits fresh `unknown shorthand flag: 'p' in -p` after redeploy.
- Residual runtime issue: EMQX container starts but currently crashes on file-permission/readability in mounted `/opt/emqx/etc/*` paths unless perms are relaxed.
- Simulator endpoint for `cmpqjojp80001tpxhwxq12upu` currently reports `{"status":"stopped","connected":false}` (gateway row/runner state mismatch still needs cleanup in web DB/apply flow).

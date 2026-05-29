---
name: "Extend gateway-board-provisioning with register handshake + tailing-sensor auto-discovery"
overview: "Implements the FETCH (read board's real UUID) + DISCOVER (enumerate RS-485 children) + COMMIT (atomic identity rewrite) half of gateway provisioning, building on the Device table + RegistrationState machine from spec 2 and firmwareTypeIds from spec 1. Adds a RegistrationProposal Prisma model, four new tRPC procedures (begin/propose/commit/abort) under gateway router, a server-side auto-match algorithm with five confidence levels, a 30-minute proposal auto-expire job, optional daemon cert revocation for re-registration, a Web Serial register flow page with per-sensor checklist UX, and canvas store integration for auto-created downstream nodes. Web Serial only in v1; RS-485 only in v1; cert revocation soft-fails; tab-close recovers within 30 minutes."
created: "2026-05-28T00:00:00Z"
last_updated: "2026-05-28T00:00:00Z"
isProject: false
type: "spec"
change_id: "extend-gateway-register-handshake"
plan_status: "draft"
trigger: "apply extend-gateway-register-handshake (spec 3 of 4 in the multi-broker chain)"
todos:
  - id: t01-prisma-registration-proposal
    content: "Add RegistrationProposal model + RegistrationProposalState enum to schema.prisma"
    status: pending
  - id: t02-migration-add-registration-proposal
    content: "Generate and commit Prisma migration `add-registration-proposal` + run prisma generate"
    status: pending
  - id: t03-parse-status-output-tests
    content: "Write red tests for parseStatusOutput (golden snapshot + 11 edge cases)"
    status: pending
  - id: t04-parse-status-output-impl
    content: "Implement parseStatusOutput in apps/web/lib/board-cli/parse-status-output.ts (section regex table, _unparsed array)"
    status: pending
  - id: t05-parse-discovered-child-tests
    content: "Write red tests for parseDiscoveredChild (24-hex validation, ASCII tail, ≥8 cases)"
    status: pending
  - id: t06-parse-discovered-child-impl
    content: "Implement parseDiscoveredChild in apps/web/lib/board-cli/parse-discovered-child.ts"
    status: pending
  - id: t07-registration-matcher-tests
    content: "Write red tests for proposeRegistrationMatch (all 5 confidence passes, tie-break, unmatched/extras/unknowns, ≥20 cases)"
    status: pending
  - id: t08-registration-matcher-impl
    content: "Implement proposeRegistrationMatch in packages/api/src/lib/registration-matcher.ts"
    status: pending
  - id: t09-daemon-cert-revoke
    content: "Implement daemon-cert-revoke.ts with soft-success on 404/405/501"
    status: pending
  - id: t10-gateway-registration-tests
    content: "Write red tests for begin/propose/commit/abort gateway procedures + audit + re-register + idempotency + expiry"
    status: pending
  - id: t11-gateway-begin-procedure
    content: "Implement gateway.beginRegistration mutation (REGISTERING cascade + session id + idempotent resume)"
    status: pending
  - id: t12-gateway-propose-procedure
    content: "Implement gateway.proposeRegistration mutation (matcher invocation + RegistrationProposal insert)"
    status: pending
  - id: t13-gateway-commit-procedure
    content: "Implement gateway.commitRegistration mutation (single $transaction per design §7 + audit cascade + appendNodeToNodeConfig)"
    status: pending
  - id: t14-gateway-abort-procedure
    content: "Implement gateway.abortRegistration mutation (rollback REGISTERING → UNREGISTERED + audit)"
    status: pending
  - id: t15-gateway-register-audit-helpers
    content: "Extend writeAudit usage to emit gateway.register-{start,proposed,success,failed,aborted}, gateway.re-register-start, gateway.register-expired"
    status: pending
  - id: t16-registration-proposal-expire-job
    content: "Implement registration-proposal-expire job (5-min interval, flips PROPOSED→EXPIRED, resets device states, audit)"
    status: pending
  - id: t17-wire-expire-job
    content: "Wire startRegistrationProposalExpireJob into jobs/index.ts and route.ts bootstrap"
    status: pending
  - id: t18-register-reducer-tests
    content: "Write red tests for register-reducer state machine (every transition + payload carries)"
    status: pending
  - id: t19-register-reducer-impl
    content: "Implement register-reducer.ts state machine"
    status: pending
  - id: t20-register-page
    content: "Build register/page.tsx with port picker, status read, propose, commit orchestration + beforeunload warning"
    status: pending
  - id: t21-register-proposal-table
    content: "Build register-proposal-table.tsx per-sensor checklist with confidence pills + swap dropdowns + bulk-confirm"
    status: pending
  - id: t22-unmatched-shadows-panel
    content: "Build unmatched-shadows-panel.tsx with keep-simulated/soft-archive/keep-as-manual actions"
    status: pending
  - id: t23-extra-children-panel
    content: "Build extra-children-panel.tsx with manifest picker (filter category=sensor + parent port protocols) + auto-create checkbox"
    status: pending
  - id: t24-unknown-types-panel
    content: "Build unknown-types-panel.tsx with commit-block + docs link"
    status: pending
  - id: t25-re-register-banner
    content: "Build re-register-banner.tsx with explicit-confirm checkbox"
    status: pending
  - id: t26-canvas-store-insert-action
    content: "Extend canvas-store with insertAutoCreatedNode action + edge + deterministic offset + tests"
    status: pending
  - id: t27-gateway-detail-cta
    content: "Modify gateway detail page: Register Device / Re-register Board CTA + stuck-session banner"
    status: pending
  - id: t28-board-cli-spec-extend
    content: "Extend board-cli-spec.ts with status command sequence vocabulary"
    status: pending
  - id: t29-register-flow-ui-tests
    content: "Write register-flow.spec.tsx (happy path + unknown blocks commit + bulk-confirm + extras → canvas store)"
    status: pending
  - id: t30-e2e-register-flow
    content: "Write Playwright register-flow.spec.ts E2E with mock Web Serial returning operator's status dump"
    status: pending
  - id: t31-docs-research-refs
    content: "Verify research-refs.md is complete (already in spec dir; no action unless missing)"
    status: pending
  - id: t32-docs-device-type-authoring-update
    content: "Update docs/device-type-authoring.md with firmwareTypeIds section for register-time discoverability"
    status: pending
  - id: t33-docs-register-flow-guide
    content: "Write docs/register-flow.md operator guide"
    status: pending
  - id: t34-validation-typecheck
    content: "pnpm -r typecheck clean"
    status: pending
  - id: t35-validation-tests
    content: "pnpm -r test clean (≥80 new tests landed)"
    status: pending
  - id: t36-validation-openspec
    content: "openspec validate extend-gateway-register-handshake --strict clean"
    status: pending
---

# Plan: Extend gateway-board-provisioning with register handshake + tailing-sensor auto-discovery

## Background & Research

### Reference documents
- OpenSpec proposal: `openspec/changes/extend-gateway-register-handshake/proposal.md` (108 lines)
- OpenSpec design: `openspec/changes/extend-gateway-register-handshake/design.md` (346 lines)
- OpenSpec tasks: `openspec/changes/extend-gateway-register-handshake/tasks.md` (127 lines)
- Spec delta: `openspec/changes/extend-gateway-register-handshake/specs/gateway-board-provisioning/spec.md` (277 lines)
- Research: `.slash/workspace/research/identity-rewrite-and-provisioning.md` (already exists from prior spec work)

### Preconditions verified
- ✅ Spec 1 (`add-plugin-device-type-registry`) is **archived**. `firmwareTypeIds: string[]` is already on the manifest schema:
  - `packages/shared-types/src/device-types/schema.ts:29` — `firmwareTypeIds: z.array(z.string()).default([])`
  - Example: `packages/shared-types/src/device-types/manifests/daejak/daejak-vm.ts` has `firmwareTypeIds: ['DAEJAK_VM']`.
- ✅ Spec 2 (`add-unregistered-device-lifecycle`) is **archived**. Device model + `DeviceRegistrationState` enum + `realUuid`/`shadowUuid`/`registrationState`/`simulationDesired`/`registeredAt`/`registeredByUserId`/`portBindings` are all in Prisma.
- ✅ `Gateway.deviceKey` foreign key to `Device.deviceKey` is live (Gateway is 1:1 to its gateway Device row).
- ✅ Spec 2 introduced `createDeviceInternal` / `deleteDeviceInternal` helpers (re-used here for auto-creating extras) and the `nodeDevices` Map in the canvas store with `getDeviceByCanvasNodeId(canvasNodeId)` selector.

### Current Prisma slot

`RegistrationProposal` model goes **between `Gateway` and `NodeConfig`** in `packages/db/prisma/schema.prisma` (alphabetical). The enum `RegistrationProposalState` goes near the other enums.

### Current Device model (post-spec-2) — for the registration cascade

```prisma
enum DeviceRegistrationState {
  UNREGISTERED
  REGISTERING
  REGISTERED
  ORPHANED
}

model Device {
  deviceKey          String                  @id @default(cuid())
  siteGroupId        String
  siteGroup          SiteGroup               @relation(fields: [siteGroupId], references: [id], onDelete: Cascade)
  canvasNodeId       String
  siteId             String?
  site               Site?                   @relation(fields: [siteId], references: [id], onDelete: SetNull)
  deviceTypeId       String
  registrationState  DeviceRegistrationState @default(UNREGISTERED)
  shadowUuid         String
  realUuid           String?
  parentDeviceKey    String?
  parent             Device?                 @relation("DeviceParent", fields: [parentDeviceKey], references: [deviceKey], onDelete: SetNull)
  children           Device[]                @relation("DeviceParent")
  portBindings       Json?
  config             Json                    @default("{}")
  simulationDesired  Boolean                 @default(true)
  registeredAt       DateTime?
  registeredByUserId String?
  lastSeenAt         DateTime?
  createdAt          DateTime                @default(now())
  updatedAt          DateTime                @updatedAt
  gateway            Gateway?

  @@unique([siteGroupId, canvasNodeId])
  @@index([siteGroupId, registrationState])
  @@index([parentDeviceKey])
  @@index([realUuid])
}
```

### Current Gateway router pattern (extension surface)

`packages/api/src/routers/gateway.ts` is 753 lines, all using `orgProcedure` with `ctx.orgId`, `ctx.userId`, `ctx.prisma`. Audit pattern (lines 697-710):

```ts
void writeAudit(ctx.prisma, {
  orgId: ctx.orgId!,
  userId: ctx.userId,
  action: 'gateway.provision-success',
  targetId: input.gatewayId,
  targetType: 'Gateway',
  metadata: { /* ... */ },
});
```

Existing related procedures we extend / reuse:
- `recordProvisionSuccess` (670-713) — our audit emitter for `gateway.register-success` mirrors it.
- `issueFromDaemon` (336-439) — re-registration cert re-issuance path reuses this for new cert.
- `getProvisioningBundle` (628-668) — not modified; mentioned only for context.

### Current board CLI spec (extension target)

`packages/api/src/lib/board-cli-spec.ts` (61 lines, full body):

```typescript
export const BOARD_SERIAL_OPTIONS = { baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', bufferSize: 16384, flowControl: 'none' } as const;
export const BOARD_PROMPT_REGEX = /^CLI>\s*/;
export const BOARD_DEFAULT_FAILURE_REGEX = /\b(usage|error|invalid|fail|unknown)\b/i;
export const BOARD_CHUNKED_SUCCESS_REGEX = /Cert stored: \d+ bytes DER \(saved to flash\)\.|stored|saved|ok/i;
export const BOARD_LINE_ENDING = '\r\n';
export const BOARD_MAX_CHUNK_LINE_CHARS = 200;
export const BOARD_INTER_CHUNK_DELAY_MS = 50;
export const BOARD_OPEN_SETTLE_DELAY_MS = 500;
export const BOARD_CLOSE_TIMEOUT_MS = 15000;
export const BOARD_PROBE_TIMEOUT_MS = 3000;
export const BOARD_BOOT_TIMEOUT_MS = 5000;

export type BoardCliCommand =
  | { kind: 'single'; itemId: 'group_id' | 'broker'; commandWord: string }
  | { kind: 'chunked'; itemId: 'certca' | 'certclient' | 'certkey'; openCommand: string; closeCommand: string }
  | { kind: 'plain'; itemId: 'reboot'; command: 'reboot' };

export const BOARD_PROVISION_SEQUENCE: BoardCliCommand[] = [ /* group_id, broker, certca, certclient, certkey, reboot */ ];
```

We extend with a status-read sequence (a new `BOARD_REGISTER_SEQUENCE: BoardCliCommand[]` of just `[{ kind: 'plain', itemId: 'status', command: 'status' }]`) plus exporting `BOARD_REGISTER_STATUS_TIMEOUT_MS = 10000`.

### Current CLI session utilities (reused as-is)

`apps/web/lib/board-cli/`:
- `cli-session.ts` (1-238): `CliSession` class with `writeLine()`, `writeChunks()`, `sendCommand()`, `waitForPrompt()`, `dispose()`. Reused verbatim for the `status` send.
- `serial-port-adapter.ts` (1-27): `getSerialPortAdapter()` returns a port-picker abstraction; same gate as existing provisioning page.
- `web-serial-adapter.ts` (1-72): Reused.
- `mock-serial-adapter.ts` (1-181): Reused; we script it with the operator's status dump for tests.
- `line-break-transformer.ts` (1-20): Reused.
- `use-provisioning.ts` (1-279): Existing hook orchestrating provisioning; **NOT modified**. Our `register-reducer.ts` lives alongside it, distinct.

Browser-compat gate pattern (from `apps/web/components/gateways/provision-page-client.tsx:21`):
```ts
setSupported(typeof navigator !== 'undefined' && 'serial' in navigator);
```

### Job scheduler pattern (mirrors device-canvas-reconcile)

From `packages/api/src/jobs/device-canvas-reconcile.ts:81-90`:

```ts
export function startDeviceCanvasReconcileJob({ intervalMs = 60_000 }: ReconcileOptions = {}): (() => void) | null {
  if (process.env.ENABLE_DEVICE_RECONCILE !== 'true') return null;
  void runReconcileTick();
  const id = setInterval(() => void runReconcileTick(), intervalMs);
  return () => clearInterval(id);
}
```

`startRegistrationProposalExpireJob({ intervalMs = 300_000 })` follows the exact same shape and exports from `packages/api/src/jobs/index.ts`. Wired into `apps/web/app/api/trpc/[trpc]/route.ts` next to the existing `startDeviceCanvasReconcileJob` call using the same `globalThis.__registrationExpireCleanup` HMR-safe singleton pattern.

### Canvas store extension surface

`apps/web/stores/canvas-store.ts`:
- State (lines 52-103) has `nodes`, `edges`, `nodeDevices: Map<string, DeviceRow>`.
- `addNode(deviceTypeId, position)` (204-228) is the existing add path.
- `getDeviceByCanvasNodeId(canvasNodeId)` (line 370).
- `bulkSetNodeDevices(devices[])` (362-368).

New action `insertAutoCreatedNode({ canvasNodeId, deviceTypeId, parentCanvasNodeId, label }, gatewayPosition, idx)`:
- Builds an `xyflow` node at `{ x: gatewayPosition.x + 200 + idx*40, y: gatewayPosition.y + 100 + idx*40 }`.
- Builds an edge from gateway → new node.
- Pushes history entry; sets `isDirty: true`.
- Returns the new node id.

### NodeConfig append helper (for COMMIT extras)

From `packages/api/src/routers/nodeConfig.ts:59-187`, the `save` mutation already loads latest NodeConfig and diff/upserts. We add a new internal helper `appendNodeToNodeConfig(tx, siteGroupId, { id, type, position, data }, parentCanvasNodeId)` in `packages/api/src/lib/nodeconfig-internal.ts` that:
1. Loads the latest `active` NodeConfig version for the siteGroup inside the same `tx`.
2. Pushes the new node + edge into the persisted JSON.
3. Stamps `updatedAt`.

Called from `commitRegistration` for each `acceptExtras` decision with `placeOnCanvas: true`.

### tRPC procedure I/O shapes (canonical from design §3)

```ts
// All four are orgProcedure mutations
beginRegistration({ orgId, gatewayDeviceKey }) → { registrationSessionId, resumed: boolean }
proposeRegistration({ orgId, gatewayDeviceKey, registrationSessionId, boardReportedUuid, discoveredChildren: DiscoveredChild[] })
  → { matchPlan: MatchPlan, expiresAt: Date }
commitRegistration({ orgId, gatewayDeviceKey, registrationSessionId, decisions: RegistrationDecisions })
  → { gatewayRealUuid, committedChildCount, createdExtras: { deviceKey, canvasNodeId }[], rejectedShadowCount }
abortRegistration({ orgId, gatewayDeviceKey, registrationSessionId, reason })
  → { ok: true }
```

### Manifests and firmwareTypeIds resolution (matcher dependency)

The matcher reads manifests via the **registry aggregator** exported from `@controlai-web/shared-types` (spec 1 introduced `getDeviceTypesByCategory(...)` and `getDeviceType(id)`). To resolve `firmwareTypeCode → deviceTypeId`, the matcher iterates all manifests in category `'sensor'` (and `'gateway'` for the gateway match) and finds the one whose `firmwareTypeIds[]` array contains the discovered child's `firmwareTypeCode`. If zero manifests claim it → unknown type. If multiple → tie-break by earliest registration order (alphabetical id), with a `logger.warn({ event: 'firmware-type-multiclaim', firmwareTypeCode, candidates })`.

### Re-registration cert revocation contract

`daemon-cert-revoke.ts` calls `DELETE /v1/tenants/{tenantId}/certs/{fingerprint}` on the same daemon used by `issueFromDaemon`. Soft-success rules:
- HTTP 200/204 → `{ ok: true }`
- HTTP 404/405/501 → `{ ok: true, message: 'daemon does not support revocation; skip' }`
- HTTP 4xx/5xx other → `{ ok: false, message: <body summary up to 200 chars> }`
- Network error → `{ ok: false, message: 'network error: <err.message>' }`

`commitRegistration` calls revoke FIRST on re-register, logs a warning on `{ ok: false }`, then proceeds with `issueFromDaemon` re-call (re-issue cert) and the Device-update transaction.

### Test policy

Project policy (per project.md): every new module ships with tests. Tests precede implementation (TDD). Test framework: Vitest. UI tests use `@testing-library/react` + `vitest`. E2E tests under `tests/e2e/` use Playwright with the existing mock Web Serial adapter.

## Testing Plan

The Testing Plan and Implementation Plan share `todos[].id`s so that a single id maps to "write the red test" → "make it green" (TDD pairs).

- [ ] `t03-parse-status-output-tests`: Author `apps/web/lib/board-cli/__tests__/parse-status-output.spec.ts` — golden snapshot of the operator's pasted board output (design §4) + ≥11 edge cases: missing 485-bus section, missing MQTT subs list, extra unrecognised line in [Board Status] surfaces in `_unparsed[]`, mangled section header throws, empty input throws, only [Board Status] section, `\r\n` line endings, lone `\n`, trailing whitespace tolerance, lowercase header tolerance, mixed-case `Board ID:`. Suite RED at first commit.
- [ ] `t05-parse-discovered-child-tests`: Author `apps/web/lib/board-cli/__tests__/parse-discovered-child.spec.ts` — `0B0003000F5355533936302D` + `DAEJAK_VM` golden + ≥8 cases: wrong length returns `null`, non-printable ASCII tail flags `serialAscii: null`, all-zero serial tolerated, lowercase hex tolerated, leading whitespace rejected. Suite RED.
- [ ] `t07-registration-matcher-tests`: Author `packages/api/src/lib/__tests__/registration-matcher.spec.ts` — ≥20 cases: EXACT match by firmwareTypeId, PORT_AND_ADDRESS, ORDER_FALLBACK, LABEL_HEURISTIC, LAST_KNOWN reuse, tie-break by lowest `createdAt`, unmatched shadows, extras, unknown firmwareTypeCode, multi-claim warning path, empty discovered → all shadows unmatched, empty shadows → all discovered are extras, mixed scenario combining all confidence levels. Suite RED.
- [ ] `t10-gateway-registration-tests`: Author `packages/api/src/__tests__/gateway-registration.test.ts` — full begin/propose/commit/abort cycle against seeded DB mocks; idempotent re-begin returns existing `PROPOSED` session id (`resumed: true`); commit after `expiresAt < NOW()` rejected with code `PRECONDITION_FAILED`; commit blocked when `unknownTypes.length > 0`; re-registration path invokes `revokeCert` then `issueFromDaemon`; previousRealUuid captured in audit metadata; commit transaction rollback restores `REGISTERING` state on thrown error mid-transaction. Suite RED.
- [ ] `t18-register-reducer-tests`: Author `apps/web/lib/board-cli/__tests__/register-reducer.spec.ts` — every transition: `IDLE → CONNECTING → READING_STATUS → PROPOSING → AWAITING_USER_DECISION → COMMITTING → DONE`; failure transitions `* → FAILED`; abort transitions `* → ABORTED`; payload carries (parsed status, server proposal, user decisions). Suite RED.
- [ ] `t29-register-flow-ui-tests`: Author `apps/web/components/register/__tests__/register-flow.spec.tsx` — happy path through reducer + mock Web Serial returning the operator's exact status dump → all matches confirmed → commit fires → success surfaces; unknown-type present disables commit with tooltip; bulk-confirm checks all defaults; extras panel placing a new node triggers `insertAutoCreatedNode` (asserted via spied Zustand store). Suite RED.
- [ ] `t30-e2e-register-flow`: Author `tests/e2e/register-flow.spec.ts` — Playwright seeds SiteGroup with `daejak-main-v1` shadow + two `daejak-vm` shadows; mock serial scripted with operator's status dump; walks the register flow; asserts canvas badges flip Unregistered → Registered with `realUuid` populated. Suite RED.
- [ ] `t26-canvas-store-insert-action` (test half): Author `apps/web/stores/__tests__/canvas-store-insert.spec.ts` — inserting 3 auto-created nodes via `insertAutoCreatedNode` produces 3 nodes + 3 edges with deterministic offsets `(gw.x+200+i*40, gw.y+100+i*40)`. Suite RED.

## Implementation Plan

Each implementation task makes the matching test task green. Tasks are ordered for strict TDD execution: schema first, then pure functions (parsers + matcher), then server procedures, then jobs, then client/UI.

- [ ] `t01-prisma-registration-proposal`: Add `RegistrationProposal` model + `RegistrationProposalState` enum to `packages/db/prisma/schema.prisma` per design §3.2. Add reverse relation `registrationProposals RegistrationProposal[]` on the `Device` model (gateway side). Indexes `@@index([gatewayDeviceKey, state])`, `@@index([expiresAt])`. ~35 LOC delta.
- [ ] `t02-migration-add-registration-proposal`: Run `pnpm --filter @controlai-web/db prisma migrate dev --name add-registration-proposal` then `prisma generate`. Hand-write SQL if migrate dev requires a live DB and one isn't available (mirror the pattern used for spec 2's Device migration).
- [ ] `t04-parse-status-output-impl`: Implement `apps/web/lib/board-cli/parse-status-output.ts` exporting `parseStatusOutput(raw: string): ParsedBoardStatus`. Section-headed format `\n[Section Name]\n…`. Per-section regex tables. Unrecognised lines pushed to `_unparsed: string[]`. Pure function. ~180 LOC.
- [ ] `t06-parse-discovered-child-impl`: Implement `apps/web/lib/board-cli/parse-discovered-child.ts` exporting `parseDiscoveredChild(raw: string, reportedTypeLabel: string): DiscoveredChild | null`. 24-hex check, address byte, 8-hex firmware type code, ASCII tail decode (14 hex → 7 chars), non-printable detection. ~80 LOC.
- [ ] `t08-registration-matcher-impl`: Implement `packages/api/src/lib/registration-matcher.ts` exporting `proposeRegistrationMatch(shadows: Device[], discovered: DiscoveredChild[], lastKnownDecisions?: RegistrationDecisions | null): MatchPlan`. Five-pass priority cascade per design §5. Resolves `deviceTypeId` from `firmwareTypeCode` via manifest registry (filter category `'sensor'` for children, `'gateway'` for the gateway match — though the gateway match is just `{ boardReportedUuid }`). Tie-break by lowest `createdAt`. ~220 LOC. Also export shared types `DiscoveredChild`, `ChildMatch`, `MatchPlan`, `RegistrationDecisions` from this module (re-export from `@controlai-web/shared-types` via a thin `packages/shared-types/src/registration.ts` so both the web client and server can import the same types).
- [ ] `t09-daemon-cert-revoke`: Implement `packages/api/src/lib/daemon-cert-revoke.ts` exporting `revokeCert({ tenantId, fingerprint }): Promise<{ ok: boolean; message?: string }>`. Soft-success on 404/405/501 per design §8. Co-locate `__tests__/daemon-cert-revoke.spec.ts` covering each branch. ~80 LOC impl + ~80 LOC tests.
- [ ] `t11-gateway-begin-procedure`: Add `gateway.beginRegistration` mutation to `packages/api/src/routers/gateway.ts`. Within a single `prisma.$transaction`: (a) load the gateway Device row by `deviceKey`, (b) if an existing `PROPOSED` proposal for this gateway with `expiresAt > NOW()` exists, return `{ registrationSessionId: existing.id, resumed: true }` (idempotent resume); else (c) flip gateway + all children where `parentDeviceKey === gatewayDeviceKey` to `REGISTERING`, (d) `INSERT RegistrationProposal { id: cuid, gatewayDeviceKey, state: 'PROPOSED', expiresAt: NOW()+30min, discoveredChildrenJson: [], matchPlanJson: null, boardReportedUuid: '' }`, (e) emit `gateway.register-start` audit. Returns `{ registrationSessionId, resumed: false }`.
- [ ] `t12-gateway-propose-procedure`: Add `gateway.proposeRegistration` mutation. Loads the proposal by id; rejects when `state !== 'PROPOSED'` or `expiresAt < NOW()`. Loads shadows where `parentDeviceKey === gatewayDeviceKey`. Loads last `COMMITTED` proposal for this gateway (for `lastKnownDecisions`). Calls `proposeRegistrationMatch(shadows, discoveredChildren, lastKnown?.userDecisionsJson)`. Updates the proposal row with `boardReportedUuid`, `discoveredChildrenJson`, `matchPlanJson`. Emits `gateway.register-proposed` audit. Returns `{ matchPlan, expiresAt }`.
- [ ] `t13-gateway-commit-procedure`: Add `gateway.commitRegistration` mutation. Single `prisma.$transaction` per design §7: (1) gateway Device update (realUuid, REGISTERED, simulationDesired=false, registeredAt, registeredByUserId), (2) per `decisions.confirmedMatches` child Device update (realUuid from `discovered.raw`, REGISTERED, simulationDesired=false, portBindings, possibly upgraded `deviceTypeId`), (3) per `decisions.acceptExtras` with `placeOnCanvas: true` insert new Device + call `appendNodeToNodeConfig(tx, gateway.siteGroupId, ...)`, (4) per `decisions.rejectShadows` apply `soft-archive`/`keep-simulated`/`keep-as-manual`, (5) flip RegistrationProposal to `COMMITTED` with `userDecisionsJson` and `committedAt`, (6) write audit log rows under `gateway.register-success` (or `…-failed` if outer try/catch wraps and the tx throws). Re-register branch: BEFORE the tx, call `revokeCert(...)` + `issueFromDaemon(...)`, capture `previousRealUuid` / `previousCertFingerprint`. On re-register-success, audit includes both before/after pairs. Reject when `proposal.state !== 'PROPOSED'`, `expiresAt < NOW()`, or `matchPlan.unknownTypes.length > 0`.
- [ ] `t14-gateway-abort-procedure`: Add `gateway.abortRegistration` mutation. Single tx: (a) flip gateway + children `REGISTERING → UNREGISTERED`, (b) flip RegistrationProposal to `ABORTED` with `abortedAt` and `userDecisionsJson.reason`, (c) audit `gateway.register-aborted`.
- [ ] `t15-gateway-register-audit-helpers`: Add a small `recordRegistrationAudit` helper in `packages/api/src/routers/gateway.ts` (private, file-scoped) that wraps `writeAudit` with a consistent metadata digest: `{ gatewayDeviceKey, registrationSessionId, before: { realUuid }, after: { realUuid }, childDigest: [{ shadowDeviceKey, before, after }], certBefore, certAfter }`. Use it in all four new procedures + expiry job + cert-revoke warning path. Also document the action vocabulary at the top of the helper file.
- [ ] `t16-registration-proposal-expire-job`: Implement `packages/api/src/jobs/registration-proposal-expire.ts` exporting `startRegistrationProposalExpireJob({ intervalMs = 300_000 })`. Inside `runExpireTick`: `findMany({ where: { state: 'PROPOSED', expiresAt: { lt: new Date() } } })`; for each, run a small tx that (a) flips proposal to `EXPIRED`, (b) flips gateway + children `REGISTERING → UNREGISTERED`, (c) writes audit `gateway.register-expired`. Same env-gated pattern as `device-canvas-reconcile`. Tests in `packages/api/src/jobs/__tests__/registration-proposal-expire.spec.ts` covering tick noop when none expired, single expiry flips proposal + cascades device states + writes audit, cleanup clears interval.
- [ ] `t17-wire-expire-job`: Export from `packages/api/src/jobs/index.ts`; import + start in `apps/web/app/api/trpc/[trpc]/route.ts` using `globalThis.__registrationExpireCleanup` HMR-safe pattern.
- [ ] `t28-board-cli-spec-extend`: Add `BOARD_REGISTER_SEQUENCE` (single-entry: `{ kind: 'plain', itemId: 'status', command: 'status' }`) + `BOARD_REGISTER_STATUS_TIMEOUT_MS = 10000` to `packages/api/src/lib/board-cli-spec.ts`. Extend `BoardCliCommand` union with `itemId: 'status'` for `plain`. ~20 LOC delta.
- [ ] `t19-register-reducer-impl`: Implement `apps/web/lib/board-cli/register-reducer.ts` exporting `RegisterState`, `RegisterAction`, `INITIAL_STATE`, `registerReducer`. States: `IDLE | CONNECTING | READING_STATUS | PROPOSING | AWAITING_USER_DECISION | COMMITTING | DONE | FAILED | ABORTED`. Each carrying the appropriate payload (registrationSessionId, parsedStatus, matchPlan, decisions, error). ~200 LOC.
- [ ] `t20-register-page`: Create `apps/web/app/(app)/orgs/[orgId]/projects/[projectId]/site-groups/[siteGroupId]/gateways/[gatewayId]/register/page.tsx` (server component) + `apps/web/components/gateways/register-page-client.tsx` (the actual client). Mirror `provision-page-client.tsx` structure: browser-compat gate, port picker button, raw-console drawer, step indicator. Orchestrates: `useReducer(registerReducer)` → on START dispatch CONNECTING → request port → open CliSession → `sendCommand('status', { successRegex: BOARD_PROMPT_REGEX, timeoutMs: BOARD_REGISTER_STATUS_TIMEOUT_MS })` → `parseStatusOutput(raw)` → dispatch with parsed → call `trpc.gateway.beginRegistration` (or before, if you want REGISTERING to lock before serial — design §2 has `begin` BEFORE `status`; follow that ordering: begin → open serial → status → propose) → call `trpc.gateway.proposeRegistration` → render proposal UI → on confirm call `trpc.gateway.commitRegistration` → DONE. `beforeunload` handler warns "Registration in progress; closing will abandon the session (auto-recovered in 30 min)." Wire mode param (`?mode=new|re-register`) from `Gateway.lastProvisionedDeviceSerial` presence. ~360 LOC across the two files.
- [ ] `t21-register-proposal-table`: Create `apps/web/components/register/register-proposal-table.tsx` — per-sensor checklist UI per design §6 with confidence pills (green EXACT, amber PORT_AND_ADDRESS, gray ORDER_FALLBACK/LABEL_HEURISTIC/LAST_KNOWN, red NONE). Auto-checked defaults: EXACT + PORT_AND_ADDRESS. Swap dropdown lists other unconfirmed shadows + "Create new node" option. Bulk-confirm shortcut at top. ~280 LOC.
- [ ] `t22-unmatched-shadows-panel`: Create `apps/web/components/register/unmatched-shadows-panel.tsx`. Per-row action radio: Keep simulated / Soft-archive / Convert to manual. ~140 LOC.
- [ ] `t23-extra-children-panel`: Create `apps/web/components/register/extra-children-panel.tsx`. Manifest picker filtered by `category === 'sensor'` AND the gateway's port spec accepted protocols (derive from `getDeviceType(gateway.deviceTypeId).ports[]`). "Auto-create canvas node" checkbox. ~180 LOC.
- [ ] `t24-unknown-types-panel`: Create `apps/web/components/register/unknown-types-panel.tsx`. Blocks commit; per-row "Unknown device type" with `firmwareTypeCode` shown and link to `/docs/device-type-authoring`. ~90 LOC.
- [ ] `t25-re-register-banner`: Create `apps/web/components/register/re-register-banner.tsx`. Visible when `mode === 're-register'`. Explains revocation + new cert issuance. Explicit confirmation checkbox required before commit button enables. ~80 LOC.
- [ ] `t26-canvas-store-insert-action` (impl half): Extend `apps/web/stores/canvas-store.ts` with `insertAutoCreatedNode(spec, gatewayPosition, idx)` action per Background § canvas store extension. Returns the new canvas node id. Updates history, isDirty. ~50 LOC delta.
- [ ] `t27-gateway-detail-cta`: Modify `apps/web/components/gateways/gateway-detail-client.tsx` (currently 85 LOC). Add secondary CTA "Register Device" (when `Gateway.lastProvisionedDeviceSerial === null` AND `Gateway.deviceKey !== null`) / "Re-register Board" (when `lastProvisionedDeviceSerial !== null`). Routes to `/register?mode=new` or `/register?mode=re-register&previousSerial=...`. Disabled when `Gateway.deviceKey === null` (gateway not yet provisioned). Also: query `trpc.gateway.listStuckRegistrations({ siteGroupId })` (a tiny new query that finds `PROPOSED` proposals for this gateway with `expiresAt > NOW()`) and render a "Resume registration" banner when one exists. ~100 LOC delta (CTA + stuck-session banner).
- [ ] `t31-docs-research-refs`: Verify `openspec/changes/extend-gateway-register-handshake/research-refs.md` exists (it does — 33 lines). No edit required unless validation flags a missing link.
- [ ] `t32-docs-device-type-authoring-update`: Add a new section to `docs/device-type-authoring.md` titled "Declaring `firmwareTypeIds` for register-time discoverability" — explain the matcher's EXACT pass + multi-claim warning. ~50 LOC.
- [ ] `t33-docs-register-flow-guide`: Create `docs/register-flow.md` operator guide covering: when to register, browser compat note, port selection, per-sensor checklist semantics, extras / unmatched / unknowns handling, re-registration story, recovery from abandoned sessions. ~120 LOC.
- [ ] `t34-validation-typecheck`: `pnpm -r typecheck` clean. Fix any cross-package fallout from new exports in `@controlai-web/shared-types/registration`.
- [ ] `t35-validation-tests`: `pnpm -r test` clean. Confirm ≥80 new test cases land across parsers, matcher, gateway router, expire job, reducer, UI, E2E (target: parsers 20+, matcher 20+, gateway 12+, expire job 3+, reducer 12+, UI 8+, canvas-store 3+, E2E 2+, daemon-cert-revoke 4+).
- [ ] `t36-validation-openspec`: `pnpm openspec validate extend-gateway-register-handshake --strict` clean.

## Delegation Notes

### Batch 0 (single coder — schema gate; everything else depends on this)
- [ ] **Coder Schema** → tasks: `t01-prisma-registration-proposal`, `t02-migration-add-registration-proposal`
  - Files: `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/<timestamp>_add-registration-proposal/migration.sql`

### Batch 1 (parallel — 3 coders; all pure functions, no shared files)
- [ ] **Coder A** (parse-status-output) → tasks: `t03-parse-status-output-tests`, `t04-parse-status-output-impl`
  - Files (exclusive): `apps/web/lib/board-cli/parse-status-output.ts`, `apps/web/lib/board-cli/__tests__/parse-status-output.spec.ts`
- [ ] **Coder B** (parse-discovered-child) → tasks: `t05-parse-discovered-child-tests`, `t06-parse-discovered-child-impl`
  - Files (exclusive): `apps/web/lib/board-cli/parse-discovered-child.ts`, `apps/web/lib/board-cli/__tests__/parse-discovered-child.spec.ts`
- [ ] **Coder C** (registration-matcher + shared types re-export) → tasks: `t07-registration-matcher-tests`, `t08-registration-matcher-impl`
  - Files (exclusive): `packages/api/src/lib/registration-matcher.ts`, `packages/api/src/lib/__tests__/registration-matcher.spec.ts`, `packages/shared-types/src/registration.ts` (new), `packages/shared-types/src/index.ts` (small re-export delta)

### Batch 2 (parallel — 2 coders; server helpers, no overlap with Batch 1)
- [ ] **Coder D** (daemon-cert-revoke) → tasks: `t09-daemon-cert-revoke`
  - Files (exclusive): `packages/api/src/lib/daemon-cert-revoke.ts`, `packages/api/src/lib/__tests__/daemon-cert-revoke.spec.ts`
- [ ] **Coder E** (board-cli-spec extend) → tasks: `t28-board-cli-spec-extend`
  - Files (exclusive): `packages/api/src/lib/board-cli-spec.ts`

### Batch 3 (single coder — gateway router needs Batches 1+2 done; all four procedures share gateway.ts)
- [ ] **Coder F** (gateway router) → tasks: `t10-gateway-registration-tests`, `t11-gateway-begin-procedure`, `t12-gateway-propose-procedure`, `t13-gateway-commit-procedure`, `t14-gateway-abort-procedure`, `t15-gateway-register-audit-helpers`, plus a small read-only `gateway.listStuckRegistrations` query used by Batch 6's gateway-detail CTA work
  - Files (exclusive): `packages/api/src/routers/gateway.ts`, `packages/api/src/__tests__/gateway-registration.test.ts`, `packages/api/src/lib/nodeconfig-internal.ts` (new — for `appendNodeToNodeConfig`)

### Batch 4 (single coder — expire job; Batch 3 must be done for audit helper imports)
- [ ] **Coder G** (expire job) → tasks: `t16-registration-proposal-expire-job`, `t17-wire-expire-job`
  - Files (exclusive): `packages/api/src/jobs/registration-proposal-expire.ts`, `packages/api/src/jobs/__tests__/registration-proposal-expire.spec.ts`, `packages/api/src/jobs/index.ts` (small delta), `apps/web/app/api/trpc/[trpc]/route.ts` (small delta)

### Batch 5 (parallel — 8 coders; UI client; Batches 1–3 must be green)
- [ ] **Coder H** (reducer) → tasks: `t18-register-reducer-tests`, `t19-register-reducer-impl`
  - Files (exclusive): `apps/web/lib/board-cli/register-reducer.ts`, `apps/web/lib/board-cli/__tests__/register-reducer.spec.ts`
- [ ] **Coder I** (register page + client) → tasks: `t20-register-page`
  - Files (exclusive): `apps/web/app/(app)/orgs/[orgId]/projects/[projectId]/site-groups/[siteGroupId]/gateways/[gatewayId]/register/page.tsx`, `apps/web/components/gateways/register-page-client.tsx`
- [ ] **Coder J** (proposal table) → tasks: `t21-register-proposal-table`
  - Files (exclusive): `apps/web/components/register/register-proposal-table.tsx`
- [ ] **Coder K** (unmatched shadows panel) → tasks: `t22-unmatched-shadows-panel`
  - Files (exclusive): `apps/web/components/register/unmatched-shadows-panel.tsx`
- [ ] **Coder L** (extras panel) → tasks: `t23-extra-children-panel`
  - Files (exclusive): `apps/web/components/register/extra-children-panel.tsx`
- [ ] **Coder M** (unknown types panel) → tasks: `t24-unknown-types-panel`
  - Files (exclusive): `apps/web/components/register/unknown-types-panel.tsx`
- [ ] **Coder N** (re-register banner) → tasks: `t25-re-register-banner`
  - Files (exclusive): `apps/web/components/register/re-register-banner.tsx`
- [ ] **Coder O** (canvas-store insert action) → tasks: `t26-canvas-store-insert-action`
  - Files (exclusive): `apps/web/stores/canvas-store.ts` (small delta), `apps/web/stores/__tests__/canvas-store-insert.spec.ts`

### Batch 6 (single coder — gateway detail CTA + stuck-session banner; depends on Batch 3 `listStuckRegistrations`)
- [ ] **Coder P** (gateway detail CTA) → tasks: `t27-gateway-detail-cta`
  - Files (exclusive): `apps/web/components/gateways/gateway-detail-client.tsx`

### Batch 7 (parallel — 2 coders; tests bind Batches 5+6)
- [ ] **Coder Q** (UI integration tests) → tasks: `t29-register-flow-ui-tests`
  - Files (exclusive): `apps/web/components/register/__tests__/register-flow.spec.tsx`
- [ ] **Coder R** (E2E) → tasks: `t30-e2e-register-flow`
  - Files (exclusive): `tests/e2e/register-flow.spec.ts`, possibly a tiny `tests/e2e/fixtures/daejak-status-dump.txt`

### Batch 8 (parallel — 3 coders; docs)
- [ ] **Coder S** (research-refs verify) → tasks: `t31-docs-research-refs`
  - Files: read-only verification; if action needed, `openspec/changes/extend-gateway-register-handshake/research-refs.md`
- [ ] **Coder T** (device-type-authoring doc update) → tasks: `t32-docs-device-type-authoring-update`
  - Files (exclusive): `docs/device-type-authoring.md`
- [ ] **Coder U** (register-flow operator guide) → tasks: `t33-docs-register-flow-guide`
  - Files (exclusive): `docs/register-flow.md`

### Batch 9 (single coder — validation gate)
- [ ] **Coder V** (validation) → tasks: `t34-validation-typecheck`, `t35-validation-tests`, `t36-validation-openspec`
  - May touch any file to fix breakages, but expected to be minimal — primarily run the three commands and triage.

### Dependencies

- Batch 0 (schema) blocks everything: matcher needs Prisma `Device` type; gateway procedures need `RegistrationProposal`; expire job needs the proposal model.
- Batch 1 (parsers + matcher) and Batch 2 (cert revoke + cli-spec) are siblings — both depend only on Batch 0.
- Batch 3 (gateway router) imports the matcher (Batch 1, Coder C) and `daemon-cert-revoke` (Batch 2, Coder D). Must wait.
- Batch 4 (expire job) imports the audit helper from Batch 3 (Coder F).
- Batch 5 (UI client) imports parsers (Batches 1 A+B), reducer feeds the page (Coder H → Coder I), and the components are independent React files (no shared file).
- Batch 6 (CTA) needs the `listStuckRegistrations` query Coder F added.
- Batch 7 (tests) needs Batches 5+6 done.
- Batch 8 (docs) can run any time after Batch 0.
- Batch 9 (validation) is terminal.

### Risk Areas

- **Prisma migration safety**: Spec 2 added many migrations recently; ensure `migrate dev` does not corrupt local DB state. Hand-write SQL fallback documented in `t02`.
- **gateway.ts ownership**: Single 753-line file gets a >480-LOC delta. Single-coder ownership (Coder F) prevents merge collisions. Coder F also writes the new `nodeconfig-internal.ts` helper.
- **Shared types boundary**: `DiscoveredChild`, `MatchPlan`, `RegistrationDecisions` MUST live in `@controlai-web/shared-types` so the React client and server share them. Coder C owns this — they create `packages/shared-types/src/registration.ts` and re-export through `index.ts`.
- **`appendNodeToNodeConfig` racing with concurrent canvas saves**: The commit transaction loads the latest `active` NodeConfig version inside the same `tx`. If a parallel `nodeConfig.save` from the canvas commits between begin and commitRegistration, we may write into a stale version. Acceptable for v1 because (a) the canvas locks edits while gateway is REGISTERING in the UI per spec 2 contract, and (b) the worst case is a duplicate node that the user can manually delete; document as known limitation.
- **Web Serial test surface**: UI tests must use the mock adapter exclusively; CI cannot drive real serial. The E2E test wires the mock adapter through a Playwright fixture flag.
- **Re-registration cert revocation soft-failure**: We never block the flow on daemon revoke failure. Audit row clearly records `{ revokeOutcome: 'soft-success' | 'hard-failure' }` so operators see what happened.
- **Auto-expire job + concurrent commitRegistration**: A race window exists where a proposal becomes expired exactly as the user commits. Mitigation: the commit procedure checks `proposal.state === 'PROPOSED' AND expiresAt > NOW()` inside the same tx that updates the proposal; Postgres serialisation prevents the expire job and commit from both succeeding. The losing branch sees `PRECONDITION_FAILED` and the UI shows a "Session expired" toast.

## Done Criteria

- [ ] All `todos` in this frontmatter are `status: done` and matching body checklists are `[x]`.
- [ ] `pnpm -r typecheck` clean (`t34`).
- [ ] `pnpm -r test` clean with ≥80 new test cases across parsers, matcher, gateway procedures, expire job, reducer, UI, canvas-store, E2E, and daemon-cert-revoke (`t35`).
- [ ] `pnpm openspec validate extend-gateway-register-handshake --strict` clean (`t36`).
- [ ] OpenSpec tasks.md fully checked + spec archived via `pnpm openspec archive extend-gateway-register-handshake --yes`.
- [ ] `RegistrationProposal` rows are written/read end-to-end in at least one integration test in `gateway-registration.test.ts`.
- [ ] Manual sanity (post-merge, optional in CI): start the Next.js dev server, open a gateway detail page with a registered Gateway, see the "Register Device" CTA enabled when `deviceKey !== null`.

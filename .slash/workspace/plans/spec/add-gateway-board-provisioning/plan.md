---
name: "add-gateway-board-provisioning — browser-based STM32 provisioning"
overview: "Implement end-to-end gateway-to-board provisioning entirely from controlai-web: server-side bundle decryption + PEM→HEX conversion + 3 new tRPC procedures + 2 new DB columns; client-side Web Serial transport with SerialPortAdapter abstraction + line-buffered CLI session + useReducer state machine + orchestrator hook; minimal Korean-copy gateway detail page + provision page + dialog accordion for manual cert entry; audit logging that never touches key material; Playwright e2e via injected mock adapter; docs + openspec validation. Greenfield capability (no existing specs). pnpm monorepo, tRPC + Prisma + AES-256-GCM stack. Chrome/Edge desktop on HTTPS is a hard runtime constraint for provisioning; the rest of the app is unaffected. .slash/design/DESIGN.md is present so no Interface-Designer gate is required for the new UI."
created: "2026-05-27T00:00:00Z"
last_updated: "2026-05-27T00:00:00Z"
isProject: false
type: "spec"
change_id: "add-gateway-board-provisioning"
plan_status: "done"
trigger: "apply add-gateway-board-provisioning — execute the approved OpenSpec change end-to-end."
todos:
  # Phase A — Foundation
  - id: t1-1
    content: "Edit packages/db/prisma/schema.prisma — add lastProvisionedDeviceSerial String? and lastProvisionedAt DateTime? to model Gateway."
    status: pending
  - id: t1-2
    content: "Run pnpm --filter @controlai-web/db prisma migrate dev --name add-gateway-provisioning-tracking; commit generated migration folder."
    status: pending
  - id: t1-3
    content: "Run pnpm --filter @controlai-web/db prisma generate to refresh the typed client."
    status: pending
  - id: t1-4
    content: "Verify no other model or seed references these new fields; NULL is the correct default for existing rows."
    status: pending
  - id: t2-1
    content: "Create packages/api/src/lib/pem-to-hex.ts exporting pemToHexChunks(pem: string, chunkSize?: number): string[] with default chunkSize = 400."
    status: pending
  - id: t2-2
    content: "Implement pemToHexChunks: strip /-----[^-]+-----/g, strip /\\s/g, throw 'No base64 body found in PEM' if empty, Buffer.from(b64,'base64').toString('hex').toUpperCase(), slice to <=chunkSize."
    status: pending
  - id: t2-3
    content: "Create packages/api/src/lib/__tests__/pem-to-hex.spec.ts covering CERTIFICATE, PRIVATE KEY, RSA PRIVATE KEY, EC PRIVATE KEY, CRLF/LF, whitespace, empty body throw, chunk size override, concatenation round-trip."
    status: pending
  - id: t2-4
    content: "Run pnpm --filter @controlai-web/api test pem-to-hex and confirm pass."
    status: pending
  - id: t3-1
    content: "Create packages/api/src/lib/board-cli-spec.ts exporting BOARD_SERIAL_OPTIONS, BOARD_PROMPT_REGEX, BOARD_DEFAULT_FAILURE_REGEX, BOARD_CHUNKED_SUCCESS_REGEX, BOARD_LINE_ENDING, BOARD_MAX_CHUNK_LINE_CHARS, BOARD_INTER_CHUNK_DELAY_MS, BOARD_OPEN_SETTLE_DELAY_MS, BOARD_CLOSE_TIMEOUT_MS, BOARD_PROBE_TIMEOUT_MS, BOARD_BOOT_TIMEOUT_MS."
    status: pending
  - id: t3-2
    content: "Export discriminated-union type BoardCliCommand ({single|chunked|plain})."
    status: pending
  - id: t3-3
    content: "Export BOARD_PROVISION_SEQUENCE: BoardCliCommand[] in exact firmware-contract order (group_id, broker, certca, certclient, certkey, reboot)."
    status: pending
  - id: t3-4
    content: "Export helper buildSingleCommandLine(cmd, value) returning `${commandWord} ${value}`."
    status: pending
  - id: t3-5
    content: "Create packages/api/src/lib/__tests__/board-cli-spec.spec.ts verifying sequence order, command construction, regex matches against firmware fixtures from cli_commands.c."
    status: pending
  # Phase B — Server router
  - id: t4-1
    content: "In packages/api/src/routers/gateway.ts add imports for pemToHexChunks and BOARD_PROVISION_SEQUENCE (decryptToken / writeAudit / TRPCError already imported)."
    status: pending
  - id: t4-2
    content: "Add orgProcedure.query getProvisioningBundle({ orgId, gatewayId }): verify orgId match via siteGroup.project.orgId; FAILED_PRECONDITION Korean message when any *PemEnc empty; decryptToken x3; pemToHexChunks x3; return { groupId, endpointURL, rootCaHex, clientCertHex, clientKeyHex }."
    status: pending
  - id: t4-3
    content: "Add orgProcedure.mutation recordProvisionSuccess({ orgId, gatewayId, deviceSerial?, durationMs, completedSteps[] }): prisma.gateway.update lastProvisionedDeviceSerial + lastProvisionedAt; writeAudit gateway.provision-success with structural metadata; return { ok: true }."
    status: pending
  - id: t4-4
    content: "Add orgProcedure.mutation recordProvisionFailure({ orgId, gatewayId, deviceSerial?, durationMs, stepReached, failureReason }): writeAudit gateway.provision-failed only (do NOT touch Gateway row); return { ok: true }."
    status: pending
  - id: t4-5
    content: "Inside getProvisioningBundle, after orgProcedure auth + before decryption, writeAudit gateway.provision-start with metadata { gatewayId, outcome: 'INITIATED' }."
    status: pending
  - id: t4-6
    content: "Create packages/api/src/__tests__/gateway-provisioning.spec.ts: happy path returns bundle shape; missing PEM throws FAILED_PRECONDITION; non-member throws FORBIDDEN (via orgProcedure); recordProvisionSuccess sets lastProvisionedDeviceSerial + writes audit; recordProvisionFailure leaves row unchanged + writes failure audit."
    status: pending
  # Phase C — Adapter interface
  - id: t5-1
    content: "Create apps/web/lib/board-cli/serial-port-adapter.ts declaring SerialPortAdapter, SerialPortHandle, and re-exporting SerialOptions from @types/w3c-web-serial."
    status: pending
  - id: t5-2
    content: "Add dev dep @types/w3c-web-serial: pnpm --filter @controlai-web/web add -D @types/w3c-web-serial."
    status: pending
  - id: t5-3
    content: "Export getSerialPortAdapter(): returns globalThis.__SERIAL_ADAPTER__ when defined (Playwright injection), otherwise webSerialAdapter singleton."
    status: pending
  # Phase D — Client modules
  - id: t6-1
    content: "Create apps/web/lib/board-cli/web-serial-adapter.ts implementing SerialPortAdapter via navigator.serial."
    status: pending
  - id: t6-2
    content: "requestPort() wraps navigator.serial.requestPort(); NotFoundError (operator dismissed) resolves to a sentinel { cancelled: true } the reducer treats as IDLE."
    status: pending
  - id: t6-3
    content: "Wrap SerialPort in a SerialPortHandle exposing readable, writable, setSignals, close, info.displayName (VID/PID → human label, fallback 'Serial Port')."
    status: pending
  - id: t6-4
    content: "After port.open(opts), best-effort setSignals({ dataTerminalReady: true, requestToSend: false }) (swallow throw for VCPs that reject)."
    status: pending
  - id: t7-1
    content: "Create apps/web/lib/board-cli/mock-serial-adapter.ts: MockSerialPortAdapter with constructor taking MockScript (ordered { onWrite: RegExp; respond: string | string[] | (() => Promise<void>); delay?; closePort?; injectError? } rules); requestPort returns MockPortHandle with scripted readable stream."
    status: pending
  - id: t7-2
    content: "Provide happyPathScript() factory simulating probe → CLI>, group_id ack, broker ack, certca/certclient/certkey set + chunks silently consumed + close → 'Cert stored: N bytes DER (saved to flash).' + CLI>, reboot → connection drops."
    status: pending
  - id: t8-1
    content: "Create apps/web/lib/board-cli/cli-session.ts exporting class CliSession(handle): TextDecoderStream + LineBreakTransformer reader pipeline; TextEncoderStream writer pipeline; writeLine, sendCommand({timeoutMs,failureRegex,successRegex}) with echo-skip, waitForPrompt, dispose (does NOT close port — caller owns), on('line'|'error', cb)."
    status: pending
  - id: t8-2
    content: "Create apps/web/lib/board-cli/line-break-transformer.ts: TransformStream<string,string> per W3C example — splits on /\\r?\\n/, buffers partial last line, flushes on close."
    status: pending
  - id: t8-3
    content: "Create apps/web/lib/board-cli/__tests__/cli-session.spec.ts: prompt detect ends sendCommand; failure regex throws; success regex completes; timeout rejects with named error; echo-skip; chunked write with interChunkDelayMs; dispose unlocks streams cleanly."
    status: pending
  - id: t9-1
    content: "Create apps/web/lib/board-cli/provisioning-reducer.ts exporting ProvisioningStep enum (per D5), ProvisioningState, ProvisioningAction discriminated union, INITIAL_STATE, provisioningReducer."
    status: pending
  - id: t9-2
    content: "Reducer is pure (no I/O). Actions: START_REQUESTING_PORT, PORT_ACQUIRED, PORT_OPENED, PROBE_SUCCEEDED, PROBE_TIMED_OUT_NEEDS_BOOT, BOOT_COMPLETED, DEVICE_INFO_READ, ITEM_STARTED, CHUNK_PROGRESS, ITEM_COMPLETED, REBOOT_SENT, CONSOLE_LINE_APPENDED, STEP_FAILED, RESET."
    status: pending
  - id: t9-3
    content: "Create apps/web/lib/board-cli/__tests__/provisioning-reducer.spec.ts: happy path traverses all steps to DONE; failure at each step routes to ERROR with right step name; RESET from any state returns to IDLE."
    status: pending
  # Phase E — Hook + UI
  - id: t10-1
    content: "Create apps/web/lib/board-cli/use-provisioning.ts — useProvisioning(gatewayId, orgId) hook: owns reducer; exposes start/retry/cancel; on start fires gateway.getProvisioningBundle, awaits adapter.requestPort, opens, probes, auto-boot-recovery, reads device info (status best-effort), iterates BOARD_PROVISION_SEQUENCE dispatching state per item, sends reboot, calls gateway.recordProvisionSuccess. On failure dispatches STEP_FAILED + calls gateway.recordProvisionFailure. Cleanup on unmount/cancel disposes session + closes port."
    status: pending
  - id: t10-2
    content: "Register beforeunload listener inside the hook when state.step ∉ { IDLE, DONE, ERROR }; remove on transition out."
    status: pending
  - id: t10-3
    content: "Create apps/web/lib/board-cli/__tests__/use-provisioning.spec.tsx integration: render hook with mock adapter, assert state transitions for happy path and a forced certclient failure."
    status: pending
  - id: t11-1
    content: "Create apps/web/app/(app)/orgs/[orgId]/projects/[projectId]/site-groups/[siteGroupId]/gateways/[gatewayId]/page.tsx as a server component."
    status: pending
  - id: t11-2
    content: "Server component: await params; validate session; verify org membership; verify gateway → siteGroup → project.orgId match; redirect to gateways list on mismatch; render <GatewayDetailClient gatewayId orgId/>."
    status: pending
  - id: t11-3
    content: "Create apps/web/components/gateways/gateway-detail-client.tsx ('use client'): trpc.gateway.get.useQuery; render label/kind/mode/endpointURL/groupId/status badges/cert state badge (발급됨/미발급); '보드에 설치' gradient Link to ./provision; disable + tooltip '인증서가 아직 발급되지 않았습니다' when hasCerts === false (tooltip body links to gateway-dialog edit)."
    status: pending
  - id: t11-4
    content: "In packages/api/src/routers/gateway.ts toDTO() (lines 44–81) append hasCerts: !!row.rootCaPemEnc && !!row.clientCertPemEnc && !!row.clientKeyPemEnc; propagate to GatewayDTO type in @controlai-web/shared-types."
    status: pending
  - id: t12-1
    content: "Edit apps/web/components/gateways/gateway-dialog.tsx — add a collapsible 'cert 수동 입력 (고급)' section (mirror the existing 'Advanced (SNI routing)' collapsible pattern at lines 243–330, or shadcn Accordion if added)."
    status: pending
  - id: t12-2
    content: "Inside the accordion: three Textarea fields (rootCa, clientCert, clientKey PEM) with placeholder '-----BEGIN CERTIFICATE-----\\n...\\n-----END CERTIFICATE-----'."
    status: pending
  - id: t12-3
    content: "Validation: if any of three is filled, all three required; each must match /-----BEGIN[^-]+-----[\\s\\S]+?-----END[^-]+-----/; inline error."
    status: pending
  - id: t12-4
    content: "On submit, pass accordion PEM values into existing gateway.create / gateway.update mutation (server already encryptToken's them via BaseGatewayInput)."
    status: pending
  - id: t12-5
    content: "Verify gateway.create / gateway.update Zod inputs accept the three PEM fields (BaseGatewayInput at packages/api/src/routers/gateway.ts:26–42 already lists rootCaPem/clientCertPem/clientKeyPem as required — confirm and document)."
    status: pending
  - id: t13-1
    content: "Create apps/web/app/(app)/orgs/[orgId]/projects/[projectId]/site-groups/[siteGroupId]/gateways/[gatewayId]/provision/page.tsx (server component)."
    status: pending
  - id: t13-2
    content: "Server component: standard auth + org membership + gateway-belongs-to-org check (same as detail page)."
    status: pending
  - id: t13-3
    content: "Render <ProvisionPageClient gatewayId orgId/>."
    status: pending
  - id: t13-4
    content: "Create apps/web/components/gateways/provision-page-client.tsx ('use client'): feature-detect 'serial' in navigator → render <UnsupportedBrowserNotice/> otherwise gateway summary card + '포트 선택' button + step checklist + raw-console disclosure; wire useProvisioning; click handler calls start() to preserve transient activation; checklist renders BOARD_PROVISION_SEQUENCE items + pre/post pseudo-steps; yellow re-provision banner when lastProvisionedDeviceSerial non-null; yellow running banner when desiredState==='running'; red failure banner with '재시도' (dispatches RESET); '완료' card on DONE with 게이트웨이로 돌아가기 link."
    status: pending
  - id: t13-5
    content: "Create apps/web/components/gateways/unsupported-browser-notice.tsx: Korean info screen, browser-compat table, 'Chrome 다운로드' link to https://www.google.com/chrome/."
    status: pending
  # Phase F — Audit/e2e/docs/validation
  - id: t14-1
    content: "Manual verification: drive provision end-to-end via mock adapter integration test; query AuditLog and confirm gateway.provision-start + gateway.provision-success rows with expected metadata schema."
    status: pending
  - id: t14-2
    content: "Verify failure path also produces gateway.provision-start + gateway.provision-failed rows."
    status: pending
  - id: t14-3
    content: "Grep all new code for accidental PEM/HEX logging: rg -nP '(console\\.log|logger\\.|writeAudit).*((PEM|pem|hex|Hex|HEX|certHex|key))' apps/ packages/ — must return zero hits beyond structural field names."
    status: pending
  - id: t15-1
    content: "Add e2e file apps/web/e2e/provision-gateway.spec.ts (Playwright config points to ./e2e — NOT apps/web/tests/e2e/ as tasks.md says; this is a corrected path): inject window.__SERIAL_ADAPTER__ via page.addInitScript; seed org+project+siteGroup+gateway with all three PEM fields populated via tRPC server caller; sign in, navigate to gateway detail, click '보드에 설치', click '포트 선택', click '셋업 시작', assert each step ticks ✓, assert '완료' card; failure variant: mock returns failure-pattern at certclient close → red banner + '재시도' + audit row."
    status: pending
  - id: t16-1
    content: "Update apps/web/README.md (or apps/web/CLAUDE.md if present) with a 'Gateway Board Provisioning' section: prerequisites (Chrome/Edge desktop, HTTPS or localhost, STM32 USB-CDC driver), operator quick-start, troubleshooting (no port, bootloader mode, 'Cert stored' missing)."
    status: pending
  - id: t16-2
    content: "Update root README.md — one paragraph under Tech Stack/Features mentioning Web Serial STM32 provisioning."
    status: pending
  - id: t16-3
    content: "Cross-link from packages/api/src/routers/gateway.ts as a top-of-file comment: '// See openspec/changes/add-gateway-board-provisioning/ for the provisioning capability spec.'"
    status: pending
  - id: t17-1
    content: "Run openspec validate add-gateway-board-provisioning --strict — resolve any reported issues."
    status: pending
  - id: t17-2
    content: "Run pnpm typecheck across monorepo — zero errors."
    status: pending
  - id: t17-3
    content: "Run pnpm lint — zero errors/warnings on new files."
    status: pending
  - id: t17-4
    content: "Run pnpm test — all unit + integration tests pass."
    status: pending
  - id: t17-5
    content: "Run pnpm --filter @controlai-web/web exec playwright test provision-gateway — e2e passes."
    status: pending
  - id: t17-6
    content: "Hand-verify on real hardware (out-of-CI manual step before archive): plug STM32 module via USB, sign in to dev deploy, run flow end-to-end against a real Gateway, confirm board comes up with MQTT connected post-reboot."
    status: pending
---

# Plan: add-gateway-board-provisioning — browser-based STM32 provisioning

## Background & Research

### Scope (from proposal.md + spec delta)
A new capability `gateway-board-provisioning` that pushes a `Gateway` row (groupId, endpointURL, three AES-256-GCM-encrypted PEMs) onto a USB-connected STM32 board entirely from Chrome/Edge desktop via the Web Serial API. Replaces a Flutter app + Python script round-trip with a one-click flow. Greenfield: no entries under `openspec/specs/` yet — this change ADDS the first capability spec.

Design D1–D11 (design.md) lock in:
- D1 controlai-web is the only backend.
- D2 server returns HEX line arrays, plaintext PEM never crosses the wire.
- D3 board CLI commands are hardcoded constants in `board-cli-spec.ts`, no DB modeling.
- D4 SerialPortAdapter abstraction; production wraps `navigator.serial`, mock for tests.
- D5 `useReducer` (not XState) state machine; 14 step enums.
- D6 bootloader auto-recovery on probe timeout, no operator confirmation.
- D7 immediate-stop on first failure, manual retry, no auto-rollback.
- D8 browser compat is render-gate, not redirect.
- D9 beforeunload guard + adapter cleanup on pagehide.
- D10 audit metadata is structural only, never key material.
- D11 Korean copy on the two new pages and the dialog accordion label only.

### Codebase Anchors (verified by explorers)

**Gateway router** — `/Users/8bitnyan/Documents/ThinkTank/controlai-web/packages/api/src/routers/gateway.ts` (620 lines, all 13 existing procedures use `orgProcedure`). Wired into `appRouter` at `packages/api/src/root.ts:27` as `gateway: gatewayRouter`.

Existing imports (already present — no need to re-add):
```typescript
// packages/api/src/routers/gateway.ts:1–9
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { SignJWT } from 'jose';
import { router, orgProcedure } from '../trpc';
import { writeAudit } from '../lib/audit-writer';
import { encryptToken, decryptToken } from '../lib/crypto';
import { callDaemon } from '../lib/daemon-client';
import { simStart, simStop, simStatus, SimulatorError } from '../lib/simulator-client';
import type { GatewayDTO, SensorConfig, DetectBrokerEndpointResult } from '@controlai-web/shared-types';
```

The toDTO mapper (gateway.ts:44–81) currently returns 17 fields and **does NOT include `hasCerts`** — task t11-4 must append it and propagate the field through `@controlai-web/shared-types`'s `GatewayDTO`.

The existing `issueFromDaemon` at gateway.ts:329–432 shows the audit + encrypt pattern to mirror:
```typescript
await ctx.prisma.gateway.update({
  where: { id: gw.id },
  data: {
    rootCaPemEnc: encryptToken(rootCaPem),
    clientCertPemEnc: encryptToken(certResp.cert_pem),
    clientKeyPemEnc: encryptToken(certResp.key_pem),
  },
});
void writeAudit(ctx.prisma, {
  orgId: ctx.orgId!,
  userId: ctx.userId,
  action: 'gateway.issueFromDaemon',
  targetId: gw.id,
  targetType: 'Gateway',
  metadata: { fingerprint: certResp.fingerprint },
});
```

Existing audit `action` values in the codebase (naming convention `<entity>.<verb>`): `gateway.create`, `gateway.delete`, `gateway.issueFromDaemon`, `instance.register`, etc. — the three new actions follow the same form: `gateway.provision-start`, `gateway.provision-success`, `gateway.provision-failed`.

**orgProcedure** — `packages/api/src/trpc.ts:51–88`. Middleware validates session + `input.orgId` + organizationMember lookup; injects `{ prisma, session, userId, orgId, orgRole }` into ctx. New procedures MUST include `orgId: z.string().cuid()` in input and may read `ctx.orgId`/`ctx.userId`/`ctx.prisma` directly.

**Crypto** — `packages/api/src/lib/crypto.ts:41–85`. `encryptToken(plaintext)` → `iv:ct:tag` base64 triple; `decryptToken(ct)` throws on tamper. Env var `INSTANCE_TOKEN_KEY` (32-byte hex). Tests must set this before importing modules and use `_resetKeyForTest()` between cases (pattern from `packages/api/src/__tests__/crypto.test.ts:1–18`).

**Audit writer** — `packages/api/src/lib/audit-writer.ts:7–35`:
```typescript
export interface WriteAuditInput {
  orgId: string;
  userId?: string | null;
  action: string;
  targetId?: string | null;
  targetType?: string | null;
  metadata?: Record<string, unknown> | null;
}
export async function writeAudit(db: PrismaClient, input: WriteAuditInput): Promise<void>
```
Fire-and-forget — failures are logged, never thrown. Callable as `void writeAudit(...)`.

**Prisma Gateway model** — `packages/db/prisma/schema.prisma:297–322`. Already stores `rootCaPemEnc`, `clientCertPemEnc`, `clientKeyPemEnc` plus identity/broker/state columns. Migration convention is `YYYYMMDDHHmmss_<description>/` (existing example: `20260525000000_add_gateway`). Task t1-2 generates a new folder under `packages/db/prisma/migrations/`.

**AuditLog model** — `schema.prisma:233–249` — has `orgId`, `userId?`, `action`, `targetId`, `targetType`, `metadata: Json`, `createdAt`. Indexed on `orgId`, `userId`, `action`.

**Client tRPC** — `apps/web/lib/trpc/client.tsx:9` exports `trpc = createTRPCReact<AppRouter>()` plus a `TRPCProvider` (lines 17–49) wrapping `QueryClientProvider`. Server caller helper at `apps/web/lib/trpc/server.ts` exports `createServerCaller()` for Server Components — useful in e2e seed (t15-1).

**Existing gateway UI**:
- List page (server) at `apps/web/app/(app)/orgs/[orgId]/projects/[projectId]/site-groups/[siteGroupId]/gateways/page.tsx` (35 lines) renders `<GatewaysClient/>`.
- `apps/web/components/gateways/gateways-client.tsx` (173 lines) uses `trpc.gateway.list.useQuery()`; each row offers Start/Stop/Edit/Delete actions; **edit opens dialog inline** (`setEditGateway(gw)` at line 126) — there is no row-level navigation to a detail page today. The proposal expects rows to link to the new detail page; tasks.md does NOT include this navigation update. See Risk Areas.
- `apps/web/components/gateways/gateway-dialog.tsx` (607 lines, client). Form uses raw React state (no Zod). Layout uses inline tabs (Identity / Credentials / Sensors / JSON Topic). Existing collapsible "Advanced (SNI routing)" pattern at lines 243–330 uses `advancedOpen` state + ChevronDown/ChevronRight icons — the new "cert 수동 입력 (고급)" accordion (t12-1) should mirror this pattern to stay consistent. The dialog already renders three PEM textareas in the Credentials tab (lines 423–460); t12-2 must consolidate the manual-entry experience into the new accordion section (per spec scenario "Operator creates a gateway with manual certs").

**shadcn/ui primitives present** under `apps/web/components/ui/`: button, badge, card, dialog, dropdown-menu, input, label, separator, skeleton, toast, use-toast, avatar. **Missing**: Accordion, Textarea, Tooltip — Tailwind has accordion keyframes (`tailwind.config.ts:52–65`) but the component is not installed. Plan opts to mirror the existing manual-collapsible pattern (t12-1) rather than introduce new primitives; if a Tooltip is required for t11-3 ("인증서가 아직 발급되지 않았습니다"), prefer a minimal title-attribute or inline hint to avoid a new primitive dep, OR install `shadcn/ui` tooltip in t11-3. Coder E2 decides.

**Web Serial type defs**: NOT present today; t5-2 adds `@types/w3c-web-serial` as a dev dep on the `@controlai-web/web` package.

**Playwright config** — `apps/web/playwright.config.ts:1–34`. testDir is `./e2e` (NOT `./tests/e2e`). Tasks.md task 15.1 specifies `apps/web/tests/e2e/provision-gateway.spec.ts` — this is a path error in the spec; the correct location is `apps/web/e2e/provision-gateway.spec.ts` (8 existing specs are already there: canvas-undo-redo, apply-rerun, org-member-invite, setup-wizard, node-palette-drag, pipeline-apply, invalid-connection, instance-register). t15-1 uses the correct path.

**Vitest config** — `apps/web/vitest.config.ts:1–10`. Excludes e2e tests, `passWithNoTests: true`, defaults to Node env (no jsdom/happy-dom). t10-3 (`use-provisioning.spec.tsx`) needs DOM — either add `environment: 'happy-dom'` test config locally or import RTL with the renderHook helper that doesn't require DOM mount (preferred: extend vitest config with `environment: 'happy-dom'` for the board-cli test folder).

**Package manager** — pnpm 9.15.0 (root `packageManager`). All install/test commands in tasks.md use `pnpm --filter` workspace targeting:
- Migration: `pnpm --filter @controlai-web/db prisma migrate dev --name add-gateway-provisioning-tracking`
- Prisma client regen: `pnpm --filter @controlai-web/db prisma generate`
- API test: `pnpm --filter @controlai-web/api test`
- Add dev dep: `pnpm --filter @controlai-web/web add -D @types/w3c-web-serial`
- Top-level: `pnpm typecheck`, `pnpm lint`, `pnpm test`

**Korean copy** — No existing Korean strings in `apps/web/**` (zero CJK matches) and no `next-intl`/i18n setup. Per D11 the new copy is hardcoded Korean strings in TSX — no infra change.

**Design system** — `.slash/design/DESIGN.md` is present at the workspace root. Therefore the new UI (detail page, provision page, dialog accordion, unsupported-browser notice) does **not** require an Interface-Designer subagent to run first; coders consult DESIGN.md for tokens/colors/spacing precedents.

**Reference repo** for protocol invariants (read-only; never imported): `/Users/8bitnyan/Downloads/Babel-template-library-main/Daejak_MAIN_APP/App/src/cli_commands.c` for firmware command names (`group_id`, `broker` — bare, no `set` prefix; `certca|certclient|certkey set` opens chunked input, `<cmd> end` closes; success `Cert stored: N bytes DER (saved to flash).`).

## Testing Plan
- [ ] `t2-3`: pem-to-hex.spec.ts — CERTIFICATE / PRIVATE KEY / RSA PRIVATE KEY / EC PRIVATE KEY armors, CRLF tolerance, leading/trailing whitespace, multi-line, malformed (throws), known DER chunk count, chunkSize override, concat round-trip equals known hex.
- [ ] `t2-4`: run `pnpm --filter @controlai-web/api test pem-to-hex`.
- [ ] `t3-5`: board-cli-spec.spec.ts — BOARD_PROVISION_SEQUENCE order matches firmware contract (6 entries); BOARD_CHUNKED_SUCCESS_REGEX matches `"Cert stored: 1234 bytes DER (saved to flash)."`; BOARD_DEFAULT_FAILURE_REGEX matches `"Error: invalid hex data..."`, `"Usage: group_id [name]"`, `"Unknown command"`; buildSingleCommandLine assembles `"group_id GROUPID"`.
- [ ] `t4-6`: gateway-provisioning.spec.ts — happy path returns `{ groupId, endpointURL, rootCaHex[], clientCertHex[], clientKeyHex[] }`; gateway with empty `rootCaPemEnc` → FAILED_PRECONDITION with Korean message + no decryption + no audit; non-member → FORBIDDEN; `recordProvisionSuccess({ deviceSerial: 'STM32-ABC' })` updates Gateway.lastProvisionedDeviceSerial + writes `gateway.provision-success` audit; `recordProvisionFailure` leaves Gateway columns unchanged + writes `gateway.provision-failed` audit; `getProvisioningBundle` writes `gateway.provision-start` audit before decryption.
- [ ] `t8-3`: cli-session.spec.ts — sendCommand resolves on BOARD_PROMPT_REGEX; failure regex rejects with named error; success regex resolves; timeout rejects; echo-skip first line; chunked write inserts BOARD_INTER_CHUNK_DELAY_MS; dispose unlocks reader/writer cleanly without closing the port.
- [ ] `t9-3`: provisioning-reducer.spec.ts — happy traversal IDLE → REQUESTING_PORT → … → DONE includes all 14 steps; failure at SENDING_CERTCLIENT routes to ERROR with `failure.step === 'SENDING_CERTCLIENT'`; RESET from any state returns to IDLE.
- [ ] `t10-3`: use-provisioning.spec.tsx — render hook with `MockSerialPortAdapter` + `happyPathScript()`, advance to DONE, assert mock's recorded write log equals BOARD_PROVISION_SEQUENCE order; failure variant injects regex match at certclient close, assert `gateway.recordProvisionFailure` called with `stepReached === 'SENDING_CERTCLIENT'`.
- [ ] `t14-1`: AuditLog rows for happy-path provision contain `provision-start` + `provision-success` with structural metadata.
- [ ] `t14-2`: AuditLog rows for failure provision contain `provision-start` + `provision-failed`.
- [ ] `t14-3`: rg sweep finds zero PEM/HEX in console/logger/writeAudit calls beyond structural field names.
- [ ] `t15-1`: Playwright e2e — happy path tick-through + failure-variant red banner + audit row assertion.
- [ ] `t17-1` openspec validate; `t17-2` pnpm typecheck; `t17-3` pnpm lint; `t17-4` pnpm test; `t17-5` playwright; `t17-6` hardware hand-verify.

## Implementation Plan

### Section 1 — Prisma schema + migration
- [ ] `t1-1`: edit `packages/db/prisma/schema.prisma` model Gateway (lines 297–322) — append `lastProvisionedDeviceSerial String?` and `lastProvisionedAt DateTime?` before the existing `createdAt`/`updatedAt`/`@@index`.
- [ ] `t1-2`: `pnpm --filter @controlai-web/db prisma migrate dev --name add-gateway-provisioning-tracking`; commit the new `packages/db/prisma/migrations/<timestamp>_add_gateway_provisioning_tracking/` folder verbatim.
- [ ] `t1-3`: `pnpm --filter @controlai-web/db prisma generate` to regenerate the typed client (re-exported via `@controlai-web/db`).
- [ ] `t1-4`: confirm no `prisma/seed.ts` or other model reference needs to touch the new columns (NULL default is correct).

### Section 2 — PEM→HEX utility
- [ ] `t2-1`: create `packages/api/src/lib/pem-to-hex.ts` with `export function pemToHexChunks(pem: string, chunkSize = 400): string[]`.
- [ ] `t2-2`: implement per spec (strip headers/whitespace, throw if empty, base64→hex→uppercase, slice).
- [ ] `t2-3`: create `packages/api/src/lib/__tests__/pem-to-hex.spec.ts` per Testing Plan.
- [ ] `t2-4`: run `pnpm --filter @controlai-web/api test pem-to-hex` (do not run during plan execution — coder runs).

### Section 3 — Board CLI spec module
- [ ] `t3-1`: create `packages/api/src/lib/board-cli-spec.ts` with all 11 exported constants.
- [ ] `t3-2`: export the `BoardCliCommand` discriminated-union type.
- [ ] `t3-3`: export `BOARD_PROVISION_SEQUENCE` (6 entries in the documented order).
- [ ] `t3-4`: export `buildSingleCommandLine(cmd, value)` helper.
- [ ] `t3-5`: create `packages/api/src/lib/__tests__/board-cli-spec.spec.ts`.

### Section 4 — tRPC procedures on `gateway` router
- [ ] `t4-1`: edit `packages/api/src/routers/gateway.ts` imports to add `pemToHexChunks` from `../lib/pem-to-hex` and `BOARD_PROVISION_SEQUENCE` from `../lib/board-cli-spec`. (`decryptToken`, `writeAudit`, `TRPCError`, `z`, `orgProcedure` already imported.)
- [ ] `t4-2`: append `getProvisioningBundle` to `gatewayRouter` (after `streamToken` at gateway.ts:619, before the closing `})` ): load gateway with siteGroup.project relation, verify `siteGroup.project.orgId === ctx.orgId`, FAILED_PRECONDITION on any missing PemEnc, decrypt + chunk, return DTO; `t4-5` adds the `gateway.provision-start` audit write at the top of this procedure.
- [ ] `t4-3`: append `recordProvisionSuccess` (orgProcedure.mutation) — `prisma.gateway.update({ where: {id: gatewayId}, data: { lastProvisionedDeviceSerial: input.deviceSerial ?? null, lastProvisionedAt: new Date() }})` + `writeAudit({ action: 'gateway.provision-success', metadata: { gatewayId, deviceSerial: input.deviceSerial ?? 'unknown', durationMs, completedSteps, outcome: 'SUCCESS' }})`.
- [ ] `t4-4`: append `recordProvisionFailure` (orgProcedure.mutation) — `writeAudit({ action: 'gateway.provision-failed', metadata: { ...input, outcome: 'FAILURE' }})`. Does NOT update Gateway columns.
- [ ] `t4-6`: create `packages/api/src/__tests__/gateway-provisioning.spec.ts` per Testing Plan (model the env-set-before-import + prisma-mock pattern from `crypto.test.ts:1–18`; for tRPC procedures, use `appRouter.createCaller({ prisma: mockPrisma, session: { user: { id: 'u1' } } })`).

### Section 5 — Serial port adapter interface + dev dep
- [ ] `t5-2`: `pnpm --filter @controlai-web/web add -D @types/w3c-web-serial` and commit the lockfile.
- [ ] `t5-1`: create `apps/web/lib/board-cli/serial-port-adapter.ts` with `SerialPortAdapter`, `SerialPortHandle` interfaces; re-export `SerialOptions` from `@types/w3c-web-serial`.
- [ ] `t5-3`: export `getSerialPortAdapter()` resolver in the same file.

### Section 6 — Web Serial production adapter
- [ ] `t6-1`–`t6-4`: create `apps/web/lib/board-cli/web-serial-adapter.ts` implementing the interface, including the `info.displayName` derivation from `getInfo()` USB VID/PID + the best-effort DTR/RTS dance.

### Section 7 — Mock adapter
- [ ] `t7-1`: create `apps/web/lib/board-cli/mock-serial-adapter.ts` with the `MockSerialPortAdapter` class and `MockScript` type (rules support `delay`, `closePort`, `injectError`).
- [ ] `t7-2`: export `happyPathScript()` factory simulating the full board-side conversation.

### Section 8 — CLI session class
- [ ] `t8-2`: create `apps/web/lib/board-cli/line-break-transformer.ts` (TransformStream<string, string>).
- [ ] `t8-1`: create `apps/web/lib/board-cli/cli-session.ts` (class CliSession with sendCommand / writeLine / waitForPrompt / dispose / on('line'|'error')).
- [ ] `t8-3`: create `apps/web/lib/board-cli/__tests__/cli-session.spec.ts` against `MockSerialPortAdapter` from Section 7.

### Section 9 — Provisioning reducer
- [ ] `t9-1`–`t9-2`: create `apps/web/lib/board-cli/provisioning-reducer.ts` (pure reducer + types).
- [ ] `t9-3`: create `apps/web/lib/board-cli/__tests__/provisioning-reducer.spec.ts`.

### Section 10 — Orchestrator hook
- [ ] `t10-1`: create `apps/web/lib/board-cli/use-provisioning.ts` (binds reducer + adapter + cli-session + tRPC; exposes start/retry/cancel).
- [ ] `t10-2`: beforeunload registration inside the hook.
- [ ] `t10-3`: create `apps/web/lib/board-cli/__tests__/use-provisioning.spec.tsx` (consumes mock adapter + tRPC msw-style fake or test caller).

### Section 11 — Gateway detail page
- [ ] `t11-4`: in `packages/api/src/routers/gateway.ts` toDTO() (lines 44–81) append `hasCerts: !!row.rootCaPemEnc && !!row.clientCertPemEnc && !!row.clientKeyPemEnc`; update `GatewayDTO` in `@controlai-web/shared-types` (`packages/shared-types/...`) to add the field — coder must locate the package and patch the type.
- [ ] `t11-1`: create `apps/web/app/(app)/orgs/[orgId]/projects/[projectId]/site-groups/[siteGroupId]/gateways/[gatewayId]/page.tsx` (server component).
- [ ] `t11-2`: implement auth + org/gateway membership check + redirect on mismatch.
- [ ] `t11-3`: create `apps/web/components/gateways/gateway-detail-client.tsx` (client) per spec — Korean labels, gradient CTA, disabled-tooltip when `hasCerts === false`.

### Section 12 — Gateway dialog manual-cert accordion
- [ ] `t12-5`: confirm `BaseGatewayInput` already lists the three PEM fields as required (gateway.ts:26–42 — verified by Explorer 3, fields present). Document in PR comment.
- [ ] `t12-1`: edit `apps/web/components/gateways/gateway-dialog.tsx` — add collapsible "cert 수동 입력 (고급)" section using the existing `advancedOpen`/ChevronDown collapsible pattern (gateway-dialog.tsx:243–330) for visual consistency.
- [ ] `t12-2`: three Textarea fields inside the new section with placeholder.
- [ ] `t12-3`: validation logic (all-or-nothing + per-field regex).
- [ ] `t12-4`: wire submit values into existing create/update mutations.

### Section 13 — Provision page
- [ ] `t13-1`–`t13-3`: create `apps/web/app/(app)/orgs/[orgId]/projects/[projectId]/site-groups/[siteGroupId]/gateways/[gatewayId]/provision/page.tsx` (server) → `<ProvisionPageClient/>`.
- [ ] `t13-4`: create `apps/web/components/gateways/provision-page-client.tsx` (client) — feature-detect → notice; otherwise summary + 포트 선택 + step checklist + raw-console disclosure + yellow re-provision/running banners + red failure banner with 재시도 + 완료 success card.
- [ ] `t13-5`: create `apps/web/components/gateways/unsupported-browser-notice.tsx` — Korean info screen + Chrome download link.

### Section 14 — Audit integration smoke
- [ ] `t14-1`–`t14-2`: drive provision via mock-adapter integration test; assert AuditLog rows.
- [ ] `t14-3`: run rg sweep for accidental key/PEM/HEX logging.

### Section 15 — Playwright e2e
- [ ] `t15-1`: create `apps/web/e2e/provision-gateway.spec.ts` (NOTE: spec mistakenly says `apps/web/tests/e2e/` — the correct dir per playwright.config.ts is `apps/web/e2e/`).

### Section 16 — Documentation
- [ ] `t16-1`: update `apps/web/README.md` (or `apps/web/CLAUDE.md` if present) — Gateway Board Provisioning section.
- [ ] `t16-2`: update root `README.md` — one paragraph mention.
- [ ] `t16-3`: add top-of-file comment to `packages/api/src/routers/gateway.ts` cross-linking the spec.

### Section 17 — Validation
- [ ] `t17-1`–`t17-5`: run openspec validate --strict, pnpm typecheck, pnpm lint, pnpm test, pnpm --filter @controlai-web/web exec playwright test provision-gateway.
- [ ] `t17-6`: real-hardware hand-verify (out-of-CI before archive).

## Delegation Notes

### Phase A — Foundation (parallel; A1 must complete before any DB-touching code in Phase B/C/D/E)
- [ ] Coder A1 (Section 1, tasks t1-1..t1-4) → files: `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/<new-timestamp>_add_gateway_provisioning_tracking/migration.sql` (generated). NO other file touched.
- [ ] Coder A2 (Section 2, tasks t2-1..t2-4) → files: `packages/api/src/lib/pem-to-hex.ts`, `packages/api/src/lib/__tests__/pem-to-hex.spec.ts`. NO other file.
- [ ] Coder A3 (Section 3, tasks t3-1..t3-5) → files: `packages/api/src/lib/board-cli-spec.ts`, `packages/api/src/lib/__tests__/board-cli-spec.spec.ts`. NO other file.

### Phase B — Server router + tests (after Phase A complete)
- [ ] Coder B1 (Section 4, tasks t4-1..t4-6) → files: `packages/api/src/routers/gateway.ts` (append 3 procedures + add 2 imports — does NOT touch toDTO; that is reserved for E2's t11-4), `packages/api/src/__tests__/gateway-provisioning.spec.ts`. Sole owner of `gateway.ts` in this phase.

### Phase C — Client adapter interface + dev dep (after Phase A)
- [ ] Coder C1 (Section 5, tasks t5-1..t5-3) → files: `apps/web/lib/board-cli/serial-port-adapter.ts`, `apps/web/package.json` (add `@types/w3c-web-serial` dev dep), `pnpm-lock.yaml` (lockfile update). NO other file.

### Phase D — Client modules (parallel after Phase C; D2 ships before D3 finishes its tests)
- [ ] Coder D1 (Section 6, tasks t6-1..t6-4) → files: `apps/web/lib/board-cli/web-serial-adapter.ts`. NO other file.
- [ ] Coder D2 (Section 7, tasks t7-1..t7-2) → files: `apps/web/lib/board-cli/mock-serial-adapter.ts`. NO other file. **Ships first inside Phase D** so D3 tests can import the mock.
- [ ] Coder D3 (Section 8, tasks t8-1..t8-3) → files: `apps/web/lib/board-cli/cli-session.ts`, `apps/web/lib/board-cli/line-break-transformer.ts`, `apps/web/lib/board-cli/__tests__/cli-session.spec.ts`. Tests depend on D2.
- [ ] Coder D4 (Section 9, tasks t9-1..t9-3) → files: `apps/web/lib/board-cli/provisioning-reducer.ts`, `apps/web/lib/board-cli/__tests__/provisioning-reducer.spec.ts`. NO other file.

### Phase E — Hook + UI (after Phases B + D)
**Batch E.1 (parallel):**
- [ ] Coder E1 (Section 10, tasks t10-1..t10-3) → files: `apps/web/lib/board-cli/use-provisioning.ts`, `apps/web/lib/board-cli/__tests__/use-provisioning.spec.tsx`, optionally `apps/web/vitest.config.ts` (add `environment: 'happy-dom'` if RTL hook render requires it). NO other file.
- [ ] Coder E2 (Section 11, tasks t11-1..t11-4) → files: `apps/web/app/(app)/orgs/[orgId]/projects/[projectId]/site-groups/[siteGroupId]/gateways/[gatewayId]/page.tsx`, `apps/web/components/gateways/gateway-detail-client.tsx`, `packages/api/src/routers/gateway.ts` (small toDTO append in t11-4 ONLY — append `hasCerts` to the return object near lines 44–81; do not modify procedures), `packages/shared-types/src/...` (locate and patch GatewayDTO type). Coordinates with E3 to avoid simultaneous edits to `gateway-dialog.tsx` (E2 does not touch it; E3 does).
- [ ] Coder E3 (Section 12, tasks t12-1..t12-5) → files: `apps/web/components/gateways/gateway-dialog.tsx`. NO other file.

**Batch E.2 (after E1 lands):**
- [ ] Coder E4 (Section 13, tasks t13-1..t13-5) → files: `apps/web/app/(app)/orgs/[orgId]/projects/[projectId]/site-groups/[siteGroupId]/gateways/[gatewayId]/provision/page.tsx`, `apps/web/components/gateways/provision-page-client.tsx`, `apps/web/components/gateways/unsupported-browser-notice.tsx`. Depends on E1 (consumes `useProvisioning`).

### Phase F — Audit verification, e2e, docs, validation (after Phase E)
- [ ] Coder F1 (Section 14, tasks t14-1..t14-3) → no permanent file writes expected (verification + rg sweep). If t14-3 surfaces a hit, F1 patches the offending file in a follow-up batch.
- [ ] Coder F2 (Section 15, task t15-1) → files: `apps/web/e2e/provision-gateway.spec.ts` (note corrected dir vs spec). May also add a tiny seed helper under `apps/web/e2e/fixtures/` if needed.
- [ ] Coder F3 (Section 16, tasks t16-1..t16-3) → files: `apps/web/README.md` (or `apps/web/CLAUDE.md` if present — coder checks), root `README.md`, `packages/api/src/routers/gateway.ts` (top-of-file comment append for t16-3 ONLY). Must sequence AFTER E2 lands its t11-4 toDTO edit on the same file.
- [ ] Coder F4 (Section 17, tasks t17-1..t17-6) → no file writes; runs the validation suite end-to-end. t17-6 is a manual hardware check (cannot be automated); document evidence (photo or transcript) in the run log.

### Dependencies
1. **A1 → all DB-touching code in B/C/D/E.** Migration must land first or `prisma.gateway.update({ data: { lastProvisionedAt }})` in B fails type-check.
2. **A2 + A3 → B1.** B1 imports `pemToHexChunks` and `BOARD_PROVISION_SEQUENCE`.
3. **A3 → D3, D4, E1.** Client side imports `BOARD_PROVISION_SEQUENCE` and protocol constants from the server-side `@controlai-web/api` package (or the constants are re-exported through a shared package — coder verifies the import path; if `board-cli-spec.ts` is not re-exported, A3 also adds a barrel `packages/api/src/lib/index.ts` entry or coder D3/E1 imports the deep path).
4. **C1 → D1, D2, D3, D4.** All Phase D modules import the `SerialPortAdapter`/`SerialPortHandle` types from C1.
5. **D2 → D3 tests.** `cli-session.spec.ts` instantiates `MockSerialPortAdapter`.
6. **B + D → E1.** `use-provisioning` consumes both the tRPC procedures (B) and the adapter/session/reducer (D).
7. **E1 → E4.** `provision-page-client` consumes `useProvisioning`.
8. **B's toDTO change is reserved for E2, NOT B.** B1 leaves toDTO untouched; E2 owns the small `hasCerts` append. This sequencing avoids a B/E2 file conflict and keeps the DTO change with the page that needs it.
9. **F3's gateway.ts edit MUST follow E2's gateway.ts edit.** F3 only appends a top-of-file comment; trivial conflict risk but still serialized.
10. **F1, F2, F3 can run in parallel after E4; F4 runs last as the green-light gate.**

### Risk Areas

- **`gateway.ts` is touched in three phases (B/E2/F3).** Mitigation: explicit file-ownership per phase (B = append procedures + imports; E2 = small toDTO `hasCerts` append; F3 = top-of-file comment). No two coders edit it simultaneously.
- **`@controlai-web/shared-types` GatewayDTO** (referenced by gateway.ts as `import type { GatewayDTO } from '@controlai-web/shared-types'`) — E2's t11-4 must locate the type definition and add `hasCerts: boolean`. The package was not explored in detail; coder may need to update the type's tsconfig build. Allowlist for E2 includes `packages/shared-types/**` to permit this.
- **Spec/proposal asks gateways-client.tsx to link rows to the new detail page** ("existing `gateways-client.tsx` list page unchanged except for navigation linking to the new detail page") — tasks.md does NOT enumerate this. Current `gateways-client.tsx` opens edit dialog on row click (line 126 `setEditGateway(gw)`). **Decision deferred to E2 coder**: either (a) leave list page exactly as-is and reach the detail page only via a separate action (e.g., a new "상세" link in the actions cell), or (b) refactor the row to navigate to the detail page on click and move edit into the actions cell. (a) is the lowest-risk path that strictly follows tasks.md; (b) better honors the proposal but is a spec gap. Document the choice in the PR; mad-agent may amend tasks.md.
- **Vitest environment** — root vitest.config.ts is Node-only. t10-3 (`use-provisioning.spec.tsx`) and any other React-rendering test must declare `environment: 'happy-dom'` or `'jsdom'`. E1 owns this config tweak (single config file at `apps/web/vitest.config.ts`).
- **shadcn primitives missing** (Accordion, Textarea, Tooltip). E2/E3 should default to in-repo patterns (manual collapsible from gateway-dialog.tsx:243–330; native `<textarea>` styled with Tailwind; tooltip via title attribute or `data-tooltip` lightweight pattern) rather than introduce new primitives. If a primitive is genuinely required, install via `npx shadcn-ui@latest add tooltip` and commit the generated component under `apps/web/components/ui/`.
- **Web Serial runtime constraint** (Chrome/Edge desktop on HTTPS or localhost) is not a code path issue — it is a hard browser API gate. D1 and E4 both implement the gate (D1 via the adapter resolver hitting `'serial' in navigator`; E4 via render-time check). The Playwright e2e (t15-1) bypasses the gate by injecting `globalThis.__SERIAL_ADAPTER__` from a `page.addInitScript` block; the test does NOT require a real Web-Serial-capable browser context.
- **`@types/w3c-web-serial`** is added as a dev dep on the web app only. If `serial-port-adapter.ts` references `SerialOptions` and the types resolution fails, ensure `apps/web/tsconfig.json` includes the lib types (no compilerOptions.types restriction blocks them).
- **Reboot success determination** — per design.md open question, the reducer treats `writer.write('reboot')` resolution as DONE; no read-after-reboot. E1's hook implementation must follow this — do not block on prompt after reboot.

## Done Criteria
- [ ] All 68 `todos` in frontmatter are `status: done` and matching body checklist items are `[x]`.
- [ ] All `## 17. Validation` tasks pass: `openspec validate add-gateway-board-provisioning --strict`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm --filter @controlai-web/web exec playwright test provision-gateway`.
- [ ] AuditLog smoke check (t14-1, t14-2) produces the expected `gateway.provision-start` + `gateway.provision-success` / `gateway.provision-failed` rows with structural-only metadata.
- [ ] `rg -nP '(console\.log|logger\.|writeAudit).*((PEM|pem|hex|Hex|HEX|certHex|key))' apps/ packages/` (t14-3) returns zero hits beyond structural field names.
- [ ] Manual real-hardware hand-verify (t17-6) confirms a flashed board comes up on the configured MQTT broker after reboot.
- [ ] `gateway-board-provisioning` spec is ready to archive into `openspec/specs/` once the change is merged + deployed.

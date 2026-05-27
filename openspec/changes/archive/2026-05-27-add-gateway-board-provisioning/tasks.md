# Tasks: add-gateway-board-provisioning

## 1. Database schema

- [x] 1.1 Edit `packages/db/prisma/schema.prisma` — add two nullable columns to `model Gateway`:
  - `lastProvisionedDeviceSerial String?`
  - `lastProvisionedAt          DateTime?`
- [x] 1.2 Run `pnpm --filter @controlai-web/db prisma migrate dev --name add-gateway-provisioning-tracking` and commit the generated migration directory.
- [x] 1.3 Run `pnpm --filter @controlai-web/db prisma generate` to refresh the client.
- [x] 1.4 Verify no other models reference these fields; no seed update required (NULL is correct for existing rows).

## 2. Server: PEM→HEX utility

- [x] 2.1 Create `packages/api/src/lib/pem-to-hex.ts` exporting `pemToHexChunks(pem: string, chunkSize?: number): string[]` (default `chunkSize = 400`).
- [x] 2.2 Implementation:
  - Strip headers via `pem.replace(/-----[^-]+-----/g, '')`.
  - Strip all whitespace via `.replace(/\s/g, '')`.
  - Throw `new Error('No base64 body found in PEM')` if result empty.
  - Convert via `Buffer.from(b64, 'base64').toString('hex').toUpperCase()`.
  - Slice into ≤`chunkSize` strings; return array.
- [x] 2.3 Create `packages/api/src/lib/__tests__/pem-to-hex.spec.ts` — cover: CERTIFICATE, PRIVATE KEY, RSA PRIVATE KEY, EC PRIVATE KEY, CRLF line endings, leading/trailing whitespace, multi-line PEM, malformed input (throws), correct chunk count for known DER size, chunk size parameter override.
- [x] 2.4 Run `pnpm --filter @controlai-web/api test pem-to-hex` and confirm pass.

## 3. Server: board CLI spec module

- [x] 3.1 Create `packages/api/src/lib/board-cli-spec.ts` exporting:
  - `BOARD_SERIAL_OPTIONS` constant: `{ baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', bufferSize: 16384, flowControl: 'none' }`.
  - `BOARD_PROMPT_REGEX = /^CLI>\s*/`.
  - `BOARD_DEFAULT_FAILURE_REGEX = /\b(usage|error|invalid|fail|unknown)\b/i`.
  - `BOARD_CHUNKED_SUCCESS_REGEX = /Cert stored: \d+ bytes DER \(saved to flash\)\.|stored|saved|ok/i`.
  - `BOARD_LINE_ENDING = '\r\n'`.
  - `BOARD_MAX_CHUNK_LINE_CHARS = 200` (firmware accepts <400; 200 gives margin).
  - `BOARD_INTER_CHUNK_DELAY_MS = 50`.
  - `BOARD_OPEN_SETTLE_DELAY_MS = 500`.
  - `BOARD_CLOSE_TIMEOUT_MS = 15000`.
  - `BOARD_PROBE_TIMEOUT_MS = 3000`.
  - `BOARD_BOOT_TIMEOUT_MS = 5000`.
- [x] 3.2 Export the discriminated-union type `BoardCliCommand`:
  - `{ kind: 'single'; itemId: 'group_id' | 'broker'; commandWord: string }`
  - `{ kind: 'chunked'; itemId: 'certca' | 'certclient' | 'certkey'; openCommand: string; closeCommand: string }`
  - `{ kind: 'plain'; itemId: 'reboot'; command: 'reboot' }`
- [x] 3.3 Export `BOARD_PROVISION_SEQUENCE: BoardCliCommand[]` in the exact order:
  1. `{ kind: 'single', itemId: 'group_id', commandWord: 'group_id' }`
  2. `{ kind: 'single', itemId: 'broker', commandWord: 'broker' }`
  3. `{ kind: 'chunked', itemId: 'certca', openCommand: 'certca set', closeCommand: 'certca end' }`
  4. `{ kind: 'chunked', itemId: 'certclient', openCommand: 'certclient set', closeCommand: 'certclient end' }`
  5. `{ kind: 'chunked', itemId: 'certkey', openCommand: 'certkey set', closeCommand: 'certkey end' }`
  6. `{ kind: 'plain', itemId: 'reboot', command: 'reboot' }`
- [x] 3.4 Export helper `buildSingleCommandLine(cmd, value)` that returns `${commandWord} ${value}`.
- [x] 3.5 Create `packages/api/src/lib/__tests__/board-cli-spec.spec.ts` — verify sequence order, command construction, regex patterns match expected firmware responses (use fixture strings from `Daejak_MAIN_APP/App/src/cli_commands.c` like `"Cert stored: 1234 bytes DER (saved to flash)."` and `"broker set to: mqtts://x"`).

## 4. Server: tRPC procedures on `gateway` router

- [x] 4.1 In `packages/api/src/routers/gateway.ts`, import `pemToHexChunks`, `decryptToken`, `writeAudit`, `BOARD_PROVISION_SEQUENCE`.
- [x] 4.2 Add procedure `getProvisioningBundle`:
  - Input: `z.object({ orgId: z.string(), gatewayId: z.string() })`.
  - Procedure type: `orgProcedure.query(...)`.
  - Logic:
    1. Load gateway by id, verify `siteGroup.project.orgId === ctx.orgId`.
    2. If any of `rootCaPemEnc`, `clientCertPemEnc`, `clientKeyPemEnc` is empty/null → throw `TRPCError({ code: 'FAILED_PRECONDITION', message: '인증서가 아직 발급되지 않았습니다. 게이트웨이 편집에서 cert 발급 또는 수동 입력을 먼저 수행하세요.' })`.
    3. Decrypt the three with `decryptToken`.
    4. Convert each with `pemToHexChunks(pem, 400)`.
    5. Return `{ groupId, endpointURL, rootCaHex: string[], clientCertHex: string[], clientKeyHex: string[] }`.
- [x] 4.3 Add procedure `recordProvisionSuccess`:
  - Input: `z.object({ orgId, gatewayId, deviceSerial: z.string().optional(), durationMs: z.number().int().nonnegative(), completedSteps: z.array(z.string()) })`.
  - `orgProcedure.mutation`.
  - Update gateway: `data: { lastProvisionedDeviceSerial: input.deviceSerial ?? null, lastProvisionedAt: new Date() }`.
  - `await writeAudit(ctx.prisma, { orgId, userId, action: 'gateway.provision-success', targetId: gatewayId, targetType: 'Gateway', metadata: { gatewayId, deviceSerial: input.deviceSerial ?? 'unknown', durationMs, completedSteps, outcome: 'SUCCESS' } })`.
  - Return `{ ok: true }`.
- [x] 4.4 Add procedure `recordProvisionFailure`:
  - Input: `z.object({ orgId, gatewayId, deviceSerial: z.string().optional(), durationMs: z.number().int().nonnegative(), stepReached: z.string(), failureReason: z.string() })`.
  - `orgProcedure.mutation`.
  - Audit write with action `gateway.provision-failed`, metadata includes all input fields + `outcome: 'FAILURE'`.
  - Does NOT update gateway columns.
  - Return `{ ok: true }`.
- [x] 4.5 Add an audit call at the START of `getProvisioningBundle` after auth but before decryption: `gateway.provision-start` with metadata `{ gatewayId, outcome: 'INITIATED' }`. (Captures intent even if the operator never completes.)
- [x] 4.6 Update `packages/api/src/__tests__/gateway-provisioning.spec.ts` (NEW) — happy path returns bundle, missing-PEM throws FAILED_PRECONDITION, non-member throws FORBIDDEN, deviceSerial flows into lastProvisionedDeviceSerial.

## 5. Client: serial port adapter abstraction

- [x] 5.1 Create `apps/web/lib/board-cli/serial-port-adapter.ts` declaring:
  - `interface SerialPortAdapter { requestPort(): Promise<SerialPortHandle>; getGrantedPorts(): Promise<SerialPortHandle[]>; }`
  - `interface SerialPortHandle { open(opts: SerialOptions): Promise<void>; readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array>; setSignals(signals: SerialOutputSignals): Promise<void>; close(): Promise<void>; readonly info: { displayName: string }; }`
  - `SerialOptions` re-exported from `@types/w3c-web-serial` (`baudRate`, `dataBits`, `stopBits`, `parity`, `bufferSize`, `flowControl`).
- [x] 5.2 Add dev dep: `pnpm --filter @controlai-web/web add -D @types/w3c-web-serial`.
- [x] 5.3 Export `getSerialPortAdapter(): SerialPortAdapter` from `serial-port-adapter.ts` that returns `globalThis.__SERIAL_ADAPTER__` if defined (Playwright injection point), else returns `webSerialAdapter`.

## 6. Client: Web Serial production adapter

- [x] 6.1 Create `apps/web/lib/board-cli/web-serial-adapter.ts` implementing `SerialPortAdapter` by delegating to `navigator.serial`.
- [x] 6.2 `requestPort()` wraps `navigator.serial.requestPort()` — MUST be called from a user-gesture handler. On `NotFoundError` (user dismissed picker) return a sentinel `{ cancelled: true }` rejection that the reducer treats as IDLE return.
- [x] 6.3 Wrap raw `SerialPort` in a `SerialPortHandle` that exposes the streams, `setSignals`, `close`, and an `info: { displayName }` derived from `getInfo()` (USB VID/PID → human label, fall back to `'Serial Port'`).
- [x] 6.4 In `open()`, after `port.open(opts)`, call `setSignals({ dataTerminalReady: true, requestToSend: false })` (best-effort, swallow throw — some VCPs reject).

## 7. Client: mock adapter for tests / e2e

- [x] 7.1 Create `apps/web/lib/board-cli/mock-serial-adapter.ts` exporting `MockSerialPortAdapter` class with:
  - Constructor takes a `MockScript`: an ordered list of `{ onWrite: RegExp; respond: string | string[] | (() => Promise<void>) }` rules.
  - `requestPort()` returns a `MockPortHandle` whose `readable` is a `ReadableStream` that emits scripted responses as the writer matches rules.
  - Failure modes: a rule can also `delay`, `closePort`, or `injectError` to test edge cases.
- [x] 7.2 Provide a default `happyPathScript()` factory that simulates: probe → `CLI>`, `group_id ...` → `group_id set to: ... (saved)\nCLI>`, `broker ...` → `broker set to: ...\nCLI>`, `certca set` → `CA cert input mode...\n`, hex lines silently consumed, `certca end` → `Cert stored: 1234 bytes DER (saved to flash).\nCLI>`, etc., `reboot` → connection drops.

## 8. Client: CLI session class

- [x] 8.1 Create `apps/web/lib/board-cli/cli-session.ts` exporting class `CliSession`:
  - Constructor `(handle: SerialPortHandle)`.
  - Spawns `TextDecoderStream` → `LineBreakTransformer` pipeline on `handle.readable`; lazy reader.
  - Spawns `TextEncoderStream` writer pipeline on `handle.writable`; lazy writer.
  - Method `writeLine(line: string)` — append `BOARD_LINE_ENDING`, `await writer.write(...)`.
  - Method `sendCommand(cmd, { timeoutMs, failureRegex, successRegex })` — write + collect lines until `BOARD_PROMPT_REGEX`, `successRegex`, `failureRegex`, or timeout. Echo-skip first line equal to `cmd.trim()`. Return collected lines.
  - Method `waitForPrompt({ timeoutMs })`.
  - Method `dispose()` — cancel reader, close writer, await both stream-closed promises, do NOT close the port (caller owns port lifecycle).
  - Method `on('line', cb)` and `on('error', cb)` for live console drawer.
- [x] 8.2 Create `apps/web/lib/board-cli/line-break-transformer.ts` — `TransformStream<string, string>` implementation per W3C example, splits on `\r?\n`, buffers partial last line, flushes on close.
- [x] 8.3 Create `apps/web/lib/board-cli/__tests__/cli-session.spec.ts` covering: prompt detect ends `sendCommand`, failure regex throws, success regex completes, timeout rejects with named error, echo-skip works, chunked write with `interChunkDelayMs`, dispose unlocks streams cleanly.

## 9. Client: provisioning reducer

- [x] 9.1 Create `apps/web/lib/board-cli/provisioning-reducer.ts` exporting:
  - `ProvisioningStep` enum (per design.md D5).
  - `ProvisioningState` interface.
  - `ProvisioningAction` discriminated union.
  - `INITIAL_STATE: ProvisioningState`.
  - `provisioningReducer(state, action): ProvisioningState`.
- [x] 9.2 Reducer must be pure — no I/O. Actions: `START_REQUESTING_PORT`, `PORT_ACQUIRED`, `PORT_OPENED`, `PROBE_SUCCEEDED`, `PROBE_TIMED_OUT_NEEDS_BOOT`, `BOOT_COMPLETED`, `DEVICE_INFO_READ`, `ITEM_STARTED`, `CHUNK_PROGRESS`, `ITEM_COMPLETED`, `REBOOT_SENT`, `CONSOLE_LINE_APPENDED`, `STEP_FAILED`, `RESET`.
- [x] 9.3 Create `apps/web/lib/board-cli/__tests__/provisioning-reducer.spec.ts` — happy path traverses all steps to DONE; failure at any step routes to ERROR with the right step name; RESET from any state returns to IDLE.

## 10. Client: orchestrator hook

- [x] 10.1 Create `apps/web/lib/board-cli/use-provisioning.ts` — `useProvisioning(gatewayId, orgId)` hook that:
  - Owns reducer state via `useReducer`.
  - Exposes `start()`, `retry()`, `cancel()` callbacks.
  - On `start()`: fires `gateway.getProvisioningBundle` query (tRPC); awaits `adapter.requestPort()`; opens; runs probe; bootloader auto-recovery; reads device info (`status` command parse — best effort); iterates `BOARD_PROVISION_SEQUENCE` dispatching state for each item; sends `reboot`; calls `gateway.recordProvisionSuccess`.
  - On any failure: dispatches `STEP_FAILED`; calls `gateway.recordProvisionFailure`.
  - Cleanup on unmount or `cancel()`: dispose CLI session + close port.
- [x] 10.2 Register `beforeunload` listener inside the hook when state.step ∉ { IDLE, DONE, ERROR }.
- [x] 10.3 Create `apps/web/lib/board-cli/__tests__/use-provisioning.spec.tsx` (integration) — render hook with mock adapter, assert state transitions for happy path and a forced failure.

## 11. Client: gateway detail page (minimal)

- [x] 11.1 Create `apps/web/app/(app)/orgs/[orgId]/projects/[projectId]/site-groups/[siteGroupId]/gateways/[gatewayId]/page.tsx` as a server component.
- [x] 11.2 Server component:
  - Awaits `params`; validates session; verifies org membership and that the gateway belongs to a site-group in this org's project (redirect to `/orgs/[orgId]/projects/[projectId]/site-groups/[siteGroupId]/gateways` on mismatch).
  - Renders `<GatewayDetailClient gatewayId={...} orgId={...} />`.
- [x] 11.3 Create `apps/web/components/gateways/gateway-detail-client.tsx` (`'use client'`):
  - Calls `trpc.gateway.get.useQuery({ orgId, gatewayId })`.
  - Renders card: label, kind, mode, endpointURL, groupId, status badges (`desiredState`, `lastStatus`), cert state badge (computed: "발급됨" / "미발급" based on whether the three PEM fields are non-empty — derived from the existing list DTO; if list DTO doesn't include this, add a `hasCerts: boolean` to the DTO).
  - Renders "보드에 설치" gradient button (`Link` to `./provision`).
  - Disable + tooltip "인증서가 아직 발급되지 않았습니다" when `hasCerts === false`; tooltip body includes "게이트웨이 편집" link that opens existing `gateway-dialog.tsx`.
- [x] 11.4 If `GatewayDTO` does not already expose `hasCerts`, add it: in `gateway.ts` `list` and `get` DTOs append `hasCerts: !!row.rootCaPemEnc && !!row.clientCertPemEnc && !!row.clientKeyPemEnc`.

## 12. Client: gateway dialog manual-cert accordion

- [x] 12.1 Edit `apps/web/components/gateways/gateway-dialog.tsx` — add a `<details>` (or shadcn `Accordion`) section labeled "cert 수동 입력 (고급)".
- [x] 12.2 Inside, three `Textarea` fields: rootCa PEM, clientCert PEM, clientKey PEM. Placeholder: `-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----`.
- [x] 12.3 Validation: if any of the three is filled, all three must be filled and each must match `/-----BEGIN[^-]+-----[\s\S]+?-----END[^-]+-----/`. Show inline error.
- [x] 12.4 On submit, if accordion fields are filled: pass them to existing `gateway.create` / `gateway.update` mutation; the procedure already calls `encryptToken` on these inputs.
- [x] 12.5 Verify `gateway.create` / `gateway.update` Zod inputs accept these three PEM fields (they should — confirm by reading `BaseGatewayInput`).

## 13. Client: provision page

- [x] 13.1 Create `apps/web/app/(app)/orgs/[orgId]/projects/[projectId]/site-groups/[siteGroupId]/gateways/[gatewayId]/provision/page.tsx` (server component).
- [x] 13.2 Server component: standard auth + org membership + gateway-belongs-to-org check.
- [x] 13.3 Render `<ProvisionPageClient gatewayId={...} orgId={...} />`.
- [x] 13.4 Create `apps/web/components/gateways/provision-page-client.tsx` (`'use client'`):
  - On mount, feature-detect `'serial' in navigator`. If absent → render `<UnsupportedBrowserNotice />`.
  - Otherwise, render: gateway summary card (label, groupId, broker), "포트 선택" button, step checklist, raw-console disclosure.
  - Wire to `useProvisioning(gatewayId, orgId)`.
  - "포트 선택" calls `start()` — which itself calls `adapter.requestPort()` from inside the click handler (preserves transient activation).
  - Step checklist renders each item in `BOARD_PROVISION_SEQUENCE` order, plus pre-items (포트 열기, 프로브, 부트로더 boot, 보드 정보 읽기) and post-item (reboot, 완료). Each row: status icon (○ / spinner / ✓ / ✗), label, optional chunk progress bar (when chunking).
  - Show yellow `<Banner>` if `gateway.lastProvisionedDeviceSerial` is non-null: "이 게이트웨이는 yyyy-MM-dd HH:mm 에 serial=XXX 에 설치된 적이 있습니다. 계속하시겠습니까?" (does not block).
  - Show yellow `<Banner>` if `gateway.desiredState === 'running'`: "이 게이트웨이는 현재 running 상태입니다. 설치 후 자동 reboot됩니다."
  - On `state.failure`, show red banner with `failure.step` + `failure.reason` + "재시도" button (dispatches RESET, operator re-picks port).
  - On `state.step === 'DONE'`, show success card + "게이트웨이로 돌아가기" link.
- [x] 13.5 Create `apps/web/components/gateways/unsupported-browser-notice.tsx` — Korean info screen with browser-compat table and "Chrome 다운로드" link to `https://www.google.com/chrome/`.

## 14. Audit-log integration smoke check

- [x] 14.1 Manual verification: provision a mock board end-to-end (mock adapter via integration test); query `AuditLog` table; confirm rows for `provision-start`, `provision-success` exist with the expected metadata schema.
- [x] 14.2 Verify failure-path also produces `provision-start` + `provision-failed` rows.
- [x] 14.3 Grep all new code for accidental PEM/HEX logging: `rg -nP '(console\.log|logger\.|writeAudit).*((PEM|pem|hex|Hex|HEX|certHex|key))' apps/ packages/` — should return zero hits (other than the field names in audit metadata, which are structural).

## 15. e2e (Playwright)

- [x] 15.1 Add e2e file `apps/web/tests/e2e/provision-gateway.spec.ts`:
  - Inject `window.__SERIAL_ADAPTER__ = mockAdapter` via `page.addInitScript`.
  - Seed an org + project + site-group + gateway with all three PEM fields populated (via tRPC caller in a fixture).
  - Sign in, navigate to gateway detail, click "보드에 설치", click "포트 선택" (mock returns immediately), click "셋업 시작", assert each step ticks to ✓, assert "완료" card visible.
  - Failure variant: mock returns a failure-pattern line in certclient close response; assert red banner + "재시도" button + audit log row exists.

## 16. Documentation

- [x] 16.1 Update `apps/web/README.md` (or `apps/web/CLAUDE.md` if present) — add a "Gateway Board Provisioning" section: prerequisites (Chrome/Edge desktop, HTTPS or localhost, USB driver for STM32 USB-CDC), operator quick-start (gateway list → 상세 → "보드에 설치"), troubleshooting (port not listed, board in bootloader mode, "Cert stored" never appears).
- [x] 16.2 Update root `README.md` — add a one-paragraph mention under "Tech Stack" or "Features" that the web app can provision STM32 modules over USB-CDC via Web Serial in supported browsers.
- [x] 16.3 Cross-link the new spec from the gateway router file as a top-of-file comment: `// See openspec/changes/add-gateway-board-provisioning/ for the provisioning capability spec.`

## 17. Validation

- [x] 17.1 Run `openspec validate add-gateway-board-provisioning --strict` and resolve any reported issues.
- [x] 17.2 Run `pnpm typecheck` across the monorepo — zero errors.
- [x] 17.3 Run `pnpm lint` — zero errors / warnings on new files.
- [x] 17.4 Run `pnpm test` — all unit + integration tests pass.
- [x] 17.5 Run `pnpm --filter @controlai-web/web exec playwright test provision-gateway` — e2e passes.
- [x] 17.6 Hand-verify on real hardware (out-of-CI manual step before archive): plug an STM32 module via USB, sign in to a dev deploy, run the flow end-to-end against a real Gateway, confirm the board comes up with MQTT connected to the configured broker after reboot.

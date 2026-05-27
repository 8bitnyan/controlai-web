# Change: Add browser-based gateway-to-board provisioning

## Why

Today an operator who wants to flash a `Gateway` row (groupId, MQTT endpoint, three encrypted PEMs) onto an actual STM32-based "modules" board has to:

1. Open `modules_hub-main` (a separate Flutter app), navigate to the board's Settings tab.
2. Run a standalone Python script (`pem_to_der_hex.py`) against three PEM files to produce 400-char-per-line uppercase-HEX text.
3. Manually copy-paste five values (`group_id`, broker URL, three HEX-encoded certs) into five separate form fields inside `modules_hub-main`.
4. Click each "전송" button one at a time, watching the embedded serial console for `Cert stored: ... (saved to flash).`

This is error-prone (HEX paste truncation, wrong field, wrong cert), slow (10+ minutes per board), and forces operators to maintain `modules_hub-main` + Python tooling + cert files outside controlai-web. The certs and groupId already live in controlai-web's `Gateway` model — encrypted via AES-256-GCM and auto-issued by the controlai daemon's PKI — so the operator is round-tripping data through three systems that should never have left controlai-web.

The user wants: pick a gateway in controlai-web → pick a serial port → click "셋업" → done. Single browser, single click, no external tooling.

## What Changes

This change introduces a new capability `gateway-board-provisioning` that takes a `Gateway` row and pushes its configuration to a USB-connected STM32 board entirely from a Chrome / Edge desktop browser using the Web Serial API.

- **NEW CAPABILITY SPEC** `gateway-board-provisioning` — covers the end-to-end provisioning flow: bundle decryption + PEM→HEX conversion server-side, Web Serial transport client-side, CLI protocol mapping, state-machine UX, audit logging, browser-compat gating.

- **NEW tRPC PROCEDURES** in the existing `gateway` router:
  - `gateway.getProvisioningBundle({ orgId, gatewayId })` — decrypts the three `*PemEnc` fields, converts each to an array of ≤400-char uppercase-HEX lines, returns `{ groupId, endpointURL, rootCaHex[], clientCertHex[], clientKeyHex[] }`. Refuses if any PEM is missing.
  - `gateway.recordProvisionSuccess({ orgId, gatewayId, deviceSerial?, durationMs, completedSteps[] })` — writes audit log, updates `Gateway.lastProvisionedDeviceSerial` and `lastProvisionedAt`.
  - `gateway.recordProvisionFailure({ orgId, gatewayId, deviceSerial?, durationMs, stepReached, failureReason })` — writes audit log only.

- **NEW UTILITIES** under `packages/api/src/lib/`:
  - `pem-to-hex.ts` — pure function: PEM string → `string[]` of ≤400-char uppercase-HEX lines (handles CERTIFICATE / PRIVATE KEY / RSA PRIVATE KEY / EC PRIVATE KEY, both LF and CRLF, leading/trailing whitespace).
  - `board-cli-spec.ts` — declarative spec for the five board CLI commands (`group_id`, `broker`, `certca`, `certclient`, `certkey`) + `reboot`, plus protocol constants (baud, prompt regex, default success/failure patterns, chunk size, settle delays, timeouts). **No DB modeling** — values are hardcoded in this file because they are tied to firmware, not user data.

- **NEW PRISMA MIGRATION** — `Gateway` model gains two columns:
  - `lastProvisionedDeviceSerial String?`
  - `lastProvisionedAt          DateTime?`

- **NEW CLIENT MODULES** under `apps/web/lib/board-cli/`:
  - `serial-port-adapter.ts` — `SerialPortAdapter` interface abstracting Web Serial (production) from a mock (tests).
  - `web-serial-adapter.ts` — production impl wrapping `navigator.serial`.
  - `mock-serial-adapter.ts` — test impl that replays scripted board responses.
  - `cli-session.ts` — line-buffered I/O, prompt detection, `sendCommand` with timeout / success / failure patterns, chunked-write support. TypeScript port of `modules_hub-main/lib/services/serial/cli_session.dart` (reference only — no runtime dependency on that repo).
  - `provisioning-reducer.ts` — `useReducer`-based state machine for the multi-step flow.

- **NEW PAGES** under `apps/web/app/(app)/orgs/[orgId]/projects/[projectId]/site-groups/[siteGroupId]/gateways/[gatewayId]/`:
  - `page.tsx` — **minimal** gateway detail page (label / kind / mode / endpointURL / groupId / cert state). Primary CTA: "보드에 설치" button → `/provision`. Disabled when any PEM is missing; tooltip links to cert issuance. Full detail-page UX (tabs, streaming, sensor management) is **out of scope** — this spec creates only the entry point to provisioning.
  - `provision/page.tsx` — the provision flow: browser-compat gate, port picker (Web Serial `requestPort` per session), step checklist, raw-console drawer, beforeunload guard, retry on failure.

- **MODIFIED COMPONENT** `apps/web/components/gateways/gateway-dialog.tsx` — gains a collapsed "cert 수동 입력" accordion. Default behavior unchanged (auto-issue via existing `gateway.issueFromDaemon`). When expanded, operator pastes three PEMs (rootCa / clientCert / clientKey); all three required together; basic regex format validation.

- **NEW AUDIT ACTIONS**: `gateway.provision-start`, `gateway.provision-success`, `gateway.provision-failed`. Metadata: `{ gatewayId, portName?, deviceSerial?, durationMs, completedSteps, stepReached?, outcome, failureReason? }`. **PEM / HEX / key material is never logged.**

- **NEW TESTS**:
  - Unit (Vitest): `pem-to-hex.spec.ts`, `board-cli-spec.spec.ts`, `provisioning-reducer.spec.ts`, `cli-session.spec.ts` (against mock adapter).
  - Integration (Vitest): full happy-path drives reducer + mock adapter end-to-end.
  - e2e (Playwright): injects mock adapter via `globalThis.__SERIAL_ADAPTER__`; walks gateway-detail → provision → completion.

## Impact

- **Affected specs**: none existing (greenfield — controlai-web has no specs in `openspec/specs/` yet); one NEW capability spec `gateway-board-provisioning` is ADDED.
- **Affected code**:
  - `packages/db/prisma/schema.prisma` — 2 new nullable columns on `Gateway`.
  - `packages/api/src/routers/gateway.ts` — 3 new procedures appended.
  - `packages/api/src/lib/` — 2 new files (`pem-to-hex.ts`, `board-cli-spec.ts`).
  - `apps/web/lib/board-cli/` — 5 new files (adapter interface + 2 impls + cli-session + reducer).
  - `apps/web/app/(app)/.../gateways/[gatewayId]/page.tsx` — NEW.
  - `apps/web/app/(app)/.../gateways/[gatewayId]/provision/page.tsx` — NEW.
  - `apps/web/components/gateways/gateway-dialog.tsx` — accordion addition.
- **Depends on**: existing `Gateway` model + `encryptToken`/`decryptToken` + `orgProcedure` + `writeAudit` + `gateway.issueFromDaemon`. All present.
- **Breaking changes**: **none**. All schema additions are nullable; existing tRPC procedures unchanged; existing `gateways-client.tsx` list page unchanged except for navigation linking to the new detail page (no behavior regression).
- **Browser constraint** (operator-visible): provisioning requires Chrome / Edge desktop on HTTPS (or localhost). Other browsers see an info-only screen on the provision page; the rest of controlai-web is unaffected.
- **Cross-repo coupling**: **zero**. `modules_hub-main` is referenced only as a porting source (the Dart `cli_session.dart` and `setup_runner.dart` are studied to extract protocol invariants); controlai-web does not import, call, or run anything in `modules_hub-main`, and `modules_hub-main` continues to operate independently.
- **Reference codebase** used to extract the board CLI protocol: `/Users/8bitnyan/Downloads/Babel-template-library-main/Daejak_MAIN_APP/App/src/cli_commands.c` (verified actual firmware command names — `group_id <v>`, `broker <v>` are bare commands without `set` prefix; `certca|certclient|certkey set` opens chunked input, `<cmd> end` closes; firmware success message `Cert stored: N bytes DER (saved to flash).`).

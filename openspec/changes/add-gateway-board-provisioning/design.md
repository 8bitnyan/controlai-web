# Design: add-gateway-board-provisioning

## Context

The `Gateway` model in controlai-web already encodes everything a board needs to join its MQTT fabric: `groupId`, `endpointURL`, and three AES-256-GCM-encrypted PEMs (`rootCaPemEnc`, `clientCertPemEnc`, `clientKeyPemEnc`). PEMs are auto-issued by the controlai daemon's PKI via the existing `gateway.issueFromDaemon` procedure. Today this material has no path onto the physical board except through a separate Flutter app (`modules_hub-main`) and a standalone Python script. This design eliminates that detour by delivering the bundle from controlai-web directly to the board over USB serial via the browser's Web Serial API.

## Goals / Non-Goals

### Goals
- One-click provisioning: operator picks port, clicks "셋업", the page drives the board to completion.
- Keep cleartext key material off the client when possible: the server returns HEX line arrays, not PEMs.
- Reuse the existing Gateway model and PKI — no new persistence surface for cert material.
- Mock-driven testability: the entire client flow runs against a `MockSerialPortAdapter` in CI.
- Korean-first UX matching `modules_hub-main`'s operator-facing tone.

### Non-Goals
- Replace `modules_hub-main` entirely (it remains the mobile / firmware-flashing path).
- Build a full gateway detail page (tabs, telemetry, sensor edit) — only the minimum needed to host the "보드에 설치" CTA.
- Verify post-reboot MQTT connectivity from the browser (the daemon's health-poll path covers this).
- Concurrency / per-device locking (single-operator assumption; researcher's Device-lock proposal explicitly rejected).
- Per-role gating (all org members may provision).
- Firmware changes (e.g., adding a serial/MAC CLI command) — gracefully degrade to `unknown`.

## Decisions

### D1: Backend host = controlai-web (not modules_hub AWS, not a new EC2)
**Decision**: All persistence, decryption, HEX conversion, audit logging, and tRPC procedures live in controlai-web. modules_hub-main is reference-only (its `cli_session.dart` and `setup_runner.dart` are studied to extract protocol constants).

**Rationale**: The `Gateway` model already holds all five values; the daemon PKI already issues the certs; `orgProcedure` already enforces org membership; `AuditLog` already exists. Building a parallel feature in modules_hub_main's AWS DynamoDB stack or a fresh EC2 service would duplicate every existing piece and introduce a cross-system data-sync problem. controlai-web's existing infrastructure is the natural home.

**Alternatives considered**:
- *modules_hub-main AWS* — rejected: no Gateway model, no PKI integration, requires duplicating the entire org/project/gateway hierarchy.
- *Custom EC2 backend* — rejected: would re-implement everything controlai-web already does; user's existing EC2 has no domain model for this.

### D2: Server returns HEX line arrays, never plaintext PEM
**Decision**: `gateway.getProvisioningBundle` decrypts on the server, runs `pemToHexChunks(pem, 400)`, and returns `{ ..., rootCaHex: string[], clientCertHex: string[], clientKeyHex: string[] }`. Plaintext PEM never crosses the network.

**Rationale**: OWASP Logging CS lists "encryption keys and other primary secrets" as data to exclude from observable surfaces. By converting server-side:
- PEMs never sit in React state, browser DevTools, RSC serialization cache, or the JS heap.
- The HEX representation is still sensitive but is single-purpose (only valid as input to the board's `certca/certclient/certkey set` flow); it is not a usable TLS keypair without DER reassembly.
- Reduces client bundle by removing the need for a browser PEM parser.

**Alternatives considered**:
- *Plaintext PEM in response, client converts* — rejected: same key material on the wire, plus on the client heap.
- *Signed-nonce two-step redemption* (per researcher 4/6) — rejected: over-engineered for the single-operator threat model; the bundle is already org-scoped via `orgProcedure` and the response is `Cache-Control: no-store` by default in Next.js POSTs.

### D3: Hardcoded board CLI spec in `board-cli-spec.ts`
**Decision**: The five command definitions (and the `reboot` finalizer) live in a single TypeScript file as exported constants. No `BoardSettingItem` Prisma model, no DB seed, no admin CRUD.

**Rationale**: The commands are tied to firmware behavior (verified against `Daejak_MAIN_APP/App/src/cli_commands.c`), not user data. They change only when firmware changes — which would require a code review and deploy regardless. Modeling them in the DB would force ops to keep a remote table in sync with binary firmware versions, adding a failure mode for zero benefit. modules_hub-main models them in DynamoDB because it predates this design decision; controlai-web doesn't need to inherit that mistake.

**Alternatives considered**:
- *DB-modeled `BoardSettingItem`* — rejected: see above.
- *Remote firmware-metadata endpoint* — rejected: no firmware-version negotiation in scope.

### D4: Web Serial API + `SerialPortAdapter` abstraction
**Decision**: `apps/web/lib/board-cli/serial-port-adapter.ts` declares an interface; `web-serial-adapter.ts` is the production implementation; `mock-serial-adapter.ts` is the test double. The provisioning reducer talks only to the interface.

**Rationale**:
- Web Serial is the only browser-side option (no WebUSB CDC class for STM32 generally; WebHID is wrong layer).
- Testing against real hardware in CI is impossible; mocking at the lowest possible boundary keeps the rest of the code under test.
- The interface (`requestPort`, `open`, `read`, `write`, `close`, `getSignals`/`setSignals`) is intentionally narrower than `SerialPort` to minimize the mock surface.

**Constraint**: Web Serial is Chrome / Edge desktop on HTTPS only (per WICG draft + MDN compat table, as of May 2026). Firefox / Safari / Chrome-Android / Safari-iOS are unsupported. Operator gating handled in D8.

### D5: `useReducer` state machine, not XState
**Decision**: A discriminated-union `ProvisioningAction` + `provisioningReducer` lives in `provisioning-reducer.ts`. The provision page uses `useReducer(provisioningReducer, INITIAL_STATE)` and dispatches actions from `useEffect`-driven side effects.

**Rationale**: The flow is linear with ~10 deterministic transitions and a single error sink. XState would add bundle weight and ceremony with no payoff at this scale. The XState README itself recommends `@xstate/store` for "applications that do not require the full complexity of state machines"; `useReducer` is even leaner than that for a single page.

**State shape** (sketch):
```ts
type Step =
  | 'IDLE' | 'REQUESTING_PORT' | 'OPENING_PORT' | 'PROBING'
  | 'BOOTING_APP' | 'READING_DEVICE_INFO'
  | 'SENDING_GROUP_ID' | 'SENDING_BROKER'
  | 'SENDING_CERTCA' | 'SENDING_CERTCLIENT' | 'SENDING_CERTKEY'
  | 'REBOOTING' | 'DONE' | 'ERROR';

interface State {
  step: Step;
  port?: SerialPortLike;             // adapter handle, opaque
  deviceSerial?: string;
  chunkProgress?: { sent: number; total: number };
  consoleLines: string[];            // raw board output for the optional drawer
  startedAt?: number;
  completedSteps: Step[];
  failure?: { step: Step; reason: string };
}
```

### D6: Bootloader recovery is automatic
**Decision**: If the probe (`?` + 3s wait for `^CLI>\s*`) times out, the reducer transitions to `BOOTING_APP`, sends `boot`, waits up to 5s for `CLI>`, and proceeds. No operator confirmation.

**Rationale**: The user explicitly chose this in the interview; it matches modules_hub-main's behavior; it removes a friction point with no real risk (the `boot` command exists in the firmware's command table and only acts when in bootloader mode, no-op'd in application mode if the probe succeeded).

### D7: Failure policy — immediate stop, manual retry, no auto-rollback
**Decision**: On the first failure (timeout, failure-regex match, write error), the reducer transitions to `ERROR` with `failure.step` and `failure.reason` set. Subsequent items are NOT attempted. The UI shows a red banner with the failure detail and a "재시도" button that resets state to `IDLE` (forcing the operator to re-pick the port — Web Serial requires fresh user activation anyway).

**Rationale**: Partial-apply is fine on this firmware: each setting persists individually to flash on success; a partially-applied board can simply be re-provisioned and will overwrite. Auto-retry hides protocol-level problems (wrong baud, dead port) and adds latency to the common-error path.

### D8: Browser-compat is a render-gate, not a redirect
**Decision**: The provision page server-component checks the `User-Agent` client-hint (`Sec-CH-UA`) for Chromium-family; the client component additionally checks `'serial' in navigator`. Unsupported → render an info-only screen with browser-list and a "Chrome 다운로드" link. Supported but no `serial` in navigator (defective env / iframe without `serial` permission policy) → same screen.

**Rationale**: Operators on Firefox/Safari shouldn't get a 404 — they should get actionable copy. The gateway list, dialogs, and the gateway detail page remain fully functional on all browsers; only the `/provision` route is gated.

### D9: `beforeunload` guard + adapter cleanup
**Decision**: When `state.step ∉ { IDLE, DONE, ERROR }`, the provision page registers a `beforeunload` listener that returns a non-empty string (browsers display a generic "Leave site?" prompt). On `pagehide`, the cleanup routine runs unconditionally: cancel the reader, close the writer, await `port.close()`.

**Rationale**: A stuck open Web Serial port can block subsequent sessions. The firmware's own 30-second cert-input timeout provides server-side recovery for chunked mode, but client-side resource leaks must still be cleaned.

### D10: Audit metadata is structural, never material
**Decision**: The three audit actions (`provision-start`, `provision-success`, `provision-failed`) write JSON metadata containing only structural fields (gatewayId, portName, deviceSerial if read, timing, step names, outcome enum, failureReason). No PEM, no HEX, no key bytes, no chunk contents.

**Rationale**: NIST SP 800-53 AU-2 ("Event Logging") requires *who/what/when/where* but explicitly does not require logging payload contents; OWASP Logging CS prohibits logging secrets. The structural fields are sufficient for an auditor to reconstruct the operator action and correlate with Gateway state.

### D11: Korean UI on the new pages only
**Decision**: The new `gateways/[gatewayId]/page.tsx` and `gateways/[gatewayId]/provision/page.tsx`, plus the "cert 수동 입력" accordion label in `gateway-dialog.tsx`, are Korean. The existing English copy in `gateways-client.tsx`, `gateway-dialog.tsx` (other strings), and the rest of the app stays untouched.

**Rationale**: User explicitly chose Korean to match modules_hub style. Introducing `next-intl` would be a much larger change touching every existing page; a tonal inconsistency on two new pages is the acceptable trade-off and is constrained to this feature surface.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Web Serial chromium-only — operators on Mac with Safari habit will hit the gate | D8 info-only screen with explicit copy + Chrome install link. No data lost; they switch browser and continue. |
| HEX bundle is still sensitive material on the wire | TLS in transit (Vercel enforces HTTPS), `Cache-Control: no-store` on the response, client never persists. Same trust model as the existing `previewIssueFromDaemon` procedure which already returns plaintext PEM. |
| Firmware command names verified at design time but could drift | `board-cli-spec.ts` is the single source; a firmware change requires updating that file + a code review. Each command's success/failure regex is encoded so any silent rename surfaces as a failed provision. |
| Operator unplugs USB mid-provision | `closedByPeer`-style handling in the adapter triggers a graceful `ERROR` transition with `reason: '보드 연결이 끊겼습니다'`. |
| Two operators on the same gateway simultaneously | Per D1/D7, partial-apply is idempotent; whichever finishes last wins. Audit log shows both attempts. Explicit per-device lock rejected as over-spec. |
| Long PEMs (RSA-4096 keys) produce many chunks; flash-write between chunks could be slow | Firmware has a 30s cert-input timeout; `interChunkDelayMs=50` + chunk size 200 gives ample headroom for typical 2KB DER (≈ 4KB hex / 20 chunks → 1s + flash write). RSA-4096 keys (≈ 1.2KB DER → 6 chunks) are well within budget. |
| Operator closes tab mid-provision | D9 beforeunload guard + cleanup; firmware-side 30s timeout recovers any half-open chunked session. |
| Future firmware adds a `serial` / `info` CLI command we don't know about today | D-spec leaves `deviceSerial` as optional; the `READING_DEVICE_INFO` step tries `status` first and gracefully falls back to `unknown` on parse failure. Adding a parser later is a one-line config change. |
| Provisioning a Gateway whose `desiredState === 'running'` overwrites a live device's config | Yellow warning banner per the interview; user explicitly allowed this — firmware-side reboot at end re-establishes connection. |

## Migration Plan

This is purely additive. No deploy ordering constraints beyond standard Prisma migration discipline:

1. Land Prisma migration first (`prisma migrate dev --name add-gateway-provisioning-tracking`).
2. Deploy backend changes (router, lib utils) — these are no-ops without the frontend pages.
3. Deploy frontend pages.
4. No data backfill; `lastProvisionedDeviceSerial`/`lastProvisionedAt` start NULL for all existing rows.

modules_hub-main continues to operate; nothing in this change touches it.

## Open Questions

None blocking implementation. Items to handle during apply:
- Exact response of `broker mqtts://h:p` when the URL exceeds 127 chars (firmware enforces 1–127); confirm the default failure regex `\b(invalid|error|fail)\b` catches it.
- Whether the `reboot` command emits any final line before USB-CDC drops; the implementation treats "write succeeded" as completion, no read-after-reboot.
- Whether `status` output includes a stable device identifier; if so, encode a parser in `readDeviceInfo()`, otherwise leave as `unknown`.

# Interview Summary — Web Board Provisioning (controlai-web)

**Change slug:** `add-gateway-board-provisioning`
**Interview date:** 2026-05-26
**Interview channel:** Main session via `question` tool (planner subagent could not reach user UI; main agent ran the interview).

---

## Decisions (locked)

### Architecture
- **Backend host:** controlai-web alone. modules_hub_main is reference-only; controlai-web depends on NOTHING in modules_hub_main / its AWS / its DynamoDB seed.
- **Board CLI command spec:** hardcoded inside controlai-web at `packages/api/src/lib/board-cli-spec.ts`. No DB modeling for setting items.
- **Provisioning bundle wire format:** server returns `{ groupId, endpointURL, rootCaHex: string[], clientCertHex: string[], clientKeyHex: string[] }` — PEM→HEX conversion happens server-side. Plaintext PEM never crosses tRPC boundary.
- **Browser:** Web Serial API (Chrome / Edge desktop only). Firefox / Safari / mobile → info-only screen.
- **Hardware abstraction:** define `SerialPortAdapter` interface; production uses Web Serial API; tests use Mock adapter that simulates board responses.

### Board CLI commands (verified against Daejak_MAIN_APP/App/src/cli_commands.c)
| Item | Command | Mode | Notes |
|------|---------|------|-------|
| group_id | `group_id <value>` | single | NO `set` prefix. Success: `group_id set to: <name> (saved)` |
| broker | `broker <full-url>` | single | Pass full `mqtts://host:port` verbatim. Success: `broker set to: <url>`. (Separate `port` command exists but unused — firmware parses URL.) |
| certca | open=`certca set`, paste HEX lines, close=`certca end` | chunked | Success regex: `Cert stored: \d+ bytes DER \(saved to flash\)\.` |
| certclient | open=`certclient set`, paste, close=`certclient end` | chunked | same |
| certkey | open=`certkey set`, paste, close=`certkey end` | chunked | same |
| reboot | `reboot` | single | No-arg. Issued after the 5 items. |

**Transfer order (fixed):** `group_id → broker → certca → certclient → certkey → reboot`.

**Protocol invariants:**
- 115200 8N1, no flow control, line ending `\r\n`.
- Prompt regex: `/^CLI>\s*/`. Probe with `?`; 3-sec timeout → bootloader detected.
- Bootloader recovery: auto-send `boot`, no operator confirmation.
- Chunked mode: each HEX line ≤ 200 chars (firmware warns < 400), inter-chunk delay 50ms, open-settle 500ms, close-timeout 15s, firmware cert-input timeout 30s overall.
- Default failure regex: `/\b(usage|error|invalid|fail|unknown)\b/i`.
- Default chunked success regex: `/Cert stored: \d+ bytes DER \(saved to flash\)\.|stored|saved|ok/i`.

### Data model (Prisma migration)
- **Gateway model additions:**
  - `lastProvisionedDeviceSerial String?`
  - `lastProvisionedAt DateTime?`
- No new `Device` table, no provisioning lock table. (Researcher's Device-lock proposal explicitly rejected as over-spec.)

### tRPC procedures (new)
1. `gateway.getProvisioningBundle({ orgId, gatewayId })` — `orgProcedure`, decrypts 3 PEMs, converts to HEX chunks, returns bundle. Refuses if any `*PemEnc` field is empty (operator must issue/upload first).
2. `gateway.recordProvisionSuccess({ orgId, gatewayId, deviceSerial?: string, durationMs, completedSteps: string[] })` — writes audit log + updates `lastProvisionedDeviceSerial` / `lastProvisionedAt`.
3. `gateway.recordProvisionFailure({ orgId, gatewayId, deviceSerial?: string, durationMs, stepReached: string, failureReason: string })` — writes audit log only.

All three use `orgProcedure` — any org member (OWNER/ADMIN/MEMBER) may call them.

### Gateway create/edit dialog enhancement
- Existing `gateway-dialog.tsx` gains a "cert 수동 입력" accordion. Default behavior unchanged (auto-issue via `issueFromDaemon`). Operator can expand and paste 3 PEMs (rootCa / clientCert / clientKey) for the manual path.
- Validation: all 3 fields required if any is provided; format-check via regex `/-----BEGIN[^-]+-----[\s\S]+?-----END[^-]+-----/`.

### Gateway detail page (NEW, minimal scope)
- Path: `apps/web/app/(app)/orgs/[orgId]/projects/[projectId]/site-groups/[siteGroupId]/gateways/[gatewayId]/page.tsx`.
- Renders: gateway label / kind / mode / endpointURL / groupId / status badges / cert state.
- Primary CTA: "보드에 설치" button → navigates to `/.../gateways/[gatewayId]/provision`.
  - Disabled when any `*PemEnc` is empty; tooltip points operator to "cert 발급하기" action which calls existing `gateway.issueFromDaemon` or opens edit dialog.
- This spec creates ONLY the minimum detail page needed for the provision entry point. No tabs, no streaming, no sensor management — those are out of scope.

### Provision page (NEW)
- Path: `.../gateways/[gatewayId]/provision/page.tsx`.
- **Korean UI only** (matches modules_hub style; existing controlai-web English copy is not propagated here).
- **Browser-gate:** server-side render checks UA-hint for Chrome/Edge; client-side feature-detect `'serial' in navigator`. Unsupported browsers show info-only screen.
- **Layout:**
  1. Gateway summary card (label, groupId, broker)
  2. "포트 선택" button → fires `navigator.serial.requestPort()` (transient activation — must be in onClick handler). NO dropdown of remembered ports; every session triggers picker.
  3. "셋업 시작" gradient button (disabled until port selected).
  4. Step checklist:
     - ○ 포트 열기
     - ○ 보드 프로브 (`?` → `CLI>`)
     - ○ 부트로더 모드면 `boot` (스킵 가능)
     - ○ 보드 정보 읽기 (`status` 또는 다른 명령으로 시도; 실패시 unknown)
     - ○ group_id 전송
     - ○ broker 전송
     - ○ certca 전송 (청크 진행률 표시)
     - ○ certclient 전송 (청크 진행률 표시)
     - ○ certkey 전송 (청크 진행률 표시)
     - ○ reboot 명령 전송
     - ✓ 완료
  5. 각 단계 옆 상태 아이콘 + 실패시 에러 메시지 + "재시도" 버튼.
  6. 단계 펼치면 raw console output (optional, default collapsed).
- **State machine:** `useReducer` with discriminated-union action type. NOT XState.
- **Failure policy:** immediate stop on first failure; operator manually clicks 재시도 (resets from idle); no auto-retry; no rollback.
- **MQTT-connection verification:** none — `reboot` command success completes the flow.
- **beforeunload guard:** when state ≠ IDLE/DONE, register `beforeunload` listener that returns truthy string; before navigating away, cleanup runs (cancel reader, close writer, await port.close()).
- **Re-provisioning warning:** if `Gateway.lastProvisionedDeviceSerial` is set, the page shows a yellow banner "이 게이트웨이는 yyyy-mm-dd 에 serial=XXX 에 설치되었습니다. 계속하시겠습니까?" — does not block.
- **Running-state warning:** if `Gateway.desiredState === 'running'`, similar yellow banner "이 게이트웨이는 현재 running 상태입니다" — does not block.

### Audit logging
Action names: `gateway.provision-start`, `gateway.provision-success`, `gateway.provision-failed`.
Metadata fields (Json): `{ gatewayId, portName?, deviceSerial?, durationMs, completedSteps, stepReached?, outcome, failureReason? }`.
**Forbidden:** never log PEM, HEX, key material, session tokens, or browser fingerprints (beyond the implicit IP/UA captured at the HTTP layer).

### i18n
Korean-only for the new provision page and the "보드에 설치" entry on the gateway detail page. Other existing pages (gateway list, dialog) keep their current English copy; only the new accordion label "cert 수동 입력" is Korean inside the otherwise-English dialog. No `next-intl` introduction; raw Korean strings inline.

### Test strategy
- **Unit (vitest):** `pem-to-hex.ts`, `board-cli-spec.ts` command builders, provisioning state-machine reducer, response parsers.
- **Integration (vitest):** Mock SerialPortAdapter simulates a happy-path board session; full reducer-driven flow drives mock and asserts state transitions.
- **e2e (Playwright):** inject Mock adapter via `globalThis.__SERIAL_ADAPTER__`; click through the provision page from gateway detail.
- No live-hardware test in CI.

---

## Open Questions Remaining
None blocking spec authoring. The following items will surface during `apply` and be handled at that stage:

- Does firmware have a board-serial/MAC CLI command? Verified `status` exists but its output format isn't confirmed; the `status` parser may degrade gracefully to "unknown" — confirmed acceptable.
- Exact wording of the firmware's failure responses for `broker`/`group_id` (length-overflow case) — affects whether default failure regex catches them. If not, add to `failurePattern` per item.
- `reboot` may or may not respond with a final prompt before resetting USB-CDC — flow treats "command write succeeded" as DONE, no response wait.

---

## Recommended Spec Scope Cut
**IN scope:**
- Prisma migration (2 new columns on Gateway)
- Server: `pemToHexChunks` util, `board-cli-spec.ts`, 3 new tRPC procedures
- Client: Web Serial adapter abstraction, mock adapter, CLI session class, provisioning state machine, provision page, gateway detail page (minimal), gateway-dialog accordion for manual cert entry, browser-gate guard, beforeunload guard
- Audit logging integration
- Unit + integration tests + e2e with mock adapter

**Cut (explicit non-goals):**
- Full gateway detail page (tabs, streaming, sensors) — minimal only
- Device-lock table / cross-operator concurrency guards
- Per-organization role gating (all members can provision)
- next-intl integration
- modules_hub_main changes
- Firmware changes (e.g. adding a serial/MAC command)
- Live MQTT post-provision verification

---

## Out of Scope
- Bootloader-mode firmware flashing (modules_hub_main domain)
- Bluetooth or USB-OTG provisioning (mobile path)
- Multi-device parallel provisioning
- Provisioning revocation (cert revocation handled by separate daemon PKI flow)
- Audit-log viewer UI (data is written; querying is a separate spec)

# Spec Delta: gateway-board-provisioning

## ADDED Requirements

### Requirement: Gateway provisioning bundle is delivered as HEX line arrays, not plaintext PEM

The controlai-web tRPC server SHALL expose a procedure `gateway.getProvisioningBundle` that, given an `orgId` and `gatewayId`, returns the exact data needed to provision an STM32 board with that gateway's configuration. The procedure SHALL decrypt the three PEM fields server-side, convert each to an array of uppercase hexadecimal lines of at most 400 characters, and return only the HEX representation. Plaintext PEM bytes SHALL NOT cross the tRPC boundary to the client.

#### Scenario: Authorized member fetches a complete bundle

- **WHEN** an authenticated user who is a member of the gateway's organization calls `gateway.getProvisioningBundle({ orgId, gatewayId })` for a gateway whose `rootCaPemEnc`, `clientCertPemEnc`, and `clientKeyPemEnc` are all non-empty
- **THEN** the procedure SHALL return an object `{ groupId: string, endpointURL: string, rootCaHex: string[], clientCertHex: string[], clientKeyHex: string[] }`
- **AND** each `*Hex` array SHALL contain the uppercase-hex representation of the DER bytes of the corresponding PEM, sliced into entries of at most 400 characters
- **AND** an `AuditLog` row SHALL be written with action `gateway.provision-start` and metadata `{ gatewayId, outcome: 'INITIATED' }`

#### Scenario: Bundle request for a gateway without certificates is rejected

- **WHEN** the caller invokes `gateway.getProvisioningBundle` for a gateway where any of `rootCaPemEnc`, `clientCertPemEnc`, or `clientKeyPemEnc` is empty or null
- **THEN** the procedure SHALL throw `TRPCError` with `code: 'FAILED_PRECONDITION'` and a Korean message indicating the operator must issue or upload certificates first
- **AND** no PEM decryption SHALL occur
- **AND** no `provision-start` audit row SHALL be written

#### Scenario: Non-member is forbidden from the bundle

- **WHEN** an authenticated user who is NOT a member of the gateway's organization calls `gateway.getProvisioningBundle`
- **THEN** the existing `orgProcedure` middleware SHALL throw `TRPCError` with `code: 'FORBIDDEN'`
- **AND** no decryption, conversion, or audit logging SHALL occur

#### Scenario: Plaintext PEM never appears in the response payload

- **WHEN** any call to `gateway.getProvisioningBundle` succeeds
- **THEN** inspecting the serialized JSON response body SHALL NOT contain the substring `-----BEGIN ` or `-----END `
- **AND** SHALL NOT contain any sequence matching `/[A-Za-z0-9+\/=]{64,}/` that decodes to a valid X.509 or PKCS#8 structure

---

### Requirement: PEM→HEX conversion is a pure utility with predictable behavior

A pure function `pemToHexChunks(pem: string, chunkSize?: number): string[]` SHALL be exported from `packages/api/src/lib/pem-to-hex.ts`. It SHALL accept PEM input with `BEGIN CERTIFICATE`, `BEGIN PRIVATE KEY`, `BEGIN RSA PRIVATE KEY`, or `BEGIN EC PRIVATE KEY` armor, tolerate both LF and CRLF line endings and arbitrary whitespace, decode the base64 body, hex-encode the resulting DER bytes in uppercase, and return an array of chunks of at most `chunkSize` characters (default 400).

#### Scenario: Standard certificate is converted

- **WHEN** `pemToHexChunks` is called with a valid `-----BEGIN CERTIFICATE-----...-----END CERTIFICATE-----` PEM string
- **THEN** the function SHALL return a non-empty `string[]`
- **AND** every entry SHALL contain only `[0-9A-F]` characters
- **AND** every entry SHALL be at most 400 characters long
- **AND** concatenating all entries SHALL equal `Buffer.from(<b64-body>, 'base64').toString('hex').toUpperCase()`

#### Scenario: CRLF line endings are tolerated

- **WHEN** the input PEM uses `\r\n` line endings throughout
- **THEN** the function SHALL produce identical output to the same PEM with `\n` line endings

#### Scenario: Empty PEM body raises

- **WHEN** the input string contains no base64 body after stripping headers and whitespace
- **THEN** the function SHALL throw `Error` with a message containing `'No base64 body found in PEM'`

#### Scenario: Chunk size is honored

- **WHEN** `pemToHexChunks(pem, 200)` is called
- **THEN** every returned entry SHALL be at most 200 characters long
- **AND** all entries except possibly the last SHALL be exactly 200 characters long

---

### Requirement: Board CLI protocol is encoded as a single source-of-truth module

The file `packages/api/src/lib/board-cli-spec.ts` SHALL export the complete declarative spec for the board CLI: serial-link options, prompt regex, default failure regex, chunked-mode success regex, line-ending constant, chunking constants (max line chars, inter-chunk delay), and protocol timeouts. It SHALL export an ordered array `BOARD_PROVISION_SEQUENCE` containing the exact commands to send during provisioning. No other file SHALL hardcode any of these values.

#### Scenario: Sequence order matches the firmware contract

- **WHEN** any caller reads `BOARD_PROVISION_SEQUENCE`
- **THEN** the array SHALL contain exactly six entries in this order:
  1. `{ kind: 'single', itemId: 'group_id', commandWord: 'group_id' }`
  2. `{ kind: 'single', itemId: 'broker', commandWord: 'broker' }`
  3. `{ kind: 'chunked', itemId: 'certca', openCommand: 'certca set', closeCommand: 'certca end' }`
  4. `{ kind: 'chunked', itemId: 'certclient', openCommand: 'certclient set', closeCommand: 'certclient end' }`
  5. `{ kind: 'chunked', itemId: 'certkey', openCommand: 'certkey set', closeCommand: 'certkey end' }`
  6. `{ kind: 'plain', itemId: 'reboot', command: 'reboot' }`

#### Scenario: Default success regex matches verified firmware response

- **WHEN** the firmware's success line `Cert stored: 1234 bytes DER (saved to flash).` is tested against `BOARD_CHUNKED_SUCCESS_REGEX`
- **THEN** the regex SHALL match

#### Scenario: Default failure regex matches generic firmware error vocabulary

- **WHEN** lines like `Error: invalid hex data or size exceeded (max 2048 bytes).`, `Usage: group_id [name]`, or `Unknown command` are tested against `BOARD_DEFAULT_FAILURE_REGEX`
- **THEN** each line SHALL match

---

### Requirement: Gateway model tracks last-provisioned device

The Prisma `Gateway` model SHALL gain two nullable columns:
- `lastProvisionedDeviceSerial String?`
- `lastProvisionedAt          DateTime?`

These columns SHALL be set when `gateway.recordProvisionSuccess` is called and SHALL remain unchanged on failure. Existing rows SHALL have both fields default to `NULL`.

#### Scenario: Successful provision updates tracking columns

- **WHEN** `gateway.recordProvisionSuccess({ orgId, gatewayId, deviceSerial: 'STM32-ABC123', durationMs: 12000, completedSteps: [...] })` is called
- **THEN** the row SHALL be updated with `lastProvisionedDeviceSerial = 'STM32-ABC123'` and `lastProvisionedAt = NOW()`
- **AND** an `AuditLog` row SHALL be written with action `gateway.provision-success`

#### Scenario: Provision without readable device serial still completes

- **WHEN** `recordProvisionSuccess` is called without a `deviceSerial` value (firmware lacks a serial-read command)
- **THEN** the row SHALL be updated with `lastProvisionedDeviceSerial = NULL` and `lastProvisionedAt = NOW()`
- **AND** the audit metadata SHALL set `deviceSerial: 'unknown'`

#### Scenario: Provision failure does not touch tracking columns

- **WHEN** `gateway.recordProvisionFailure` is called for a gateway whose `lastProvisionedAt` was previously `2026-01-01T00:00:00Z`
- **THEN** the gateway row's `lastProvisionedDeviceSerial` and `lastProvisionedAt` columns SHALL remain unchanged
- **AND** an `AuditLog` row SHALL be written with action `gateway.provision-failed`

---

### Requirement: Provisioning is gated on supported browser

The provisioning page SHALL render only the actual provisioning UI when the Web Serial API is available; otherwise it SHALL render an info-only screen instructing the operator to use Chrome or Edge desktop.

#### Scenario: Chrome desktop user lands on the provision page

- **WHEN** an operator using Chrome on macOS/Windows/Linux navigates to `/orgs/.../gateways/[gatewayId]/provision`
- **THEN** the page SHALL render the gateway summary card, the port-picker button, the step checklist, and the raw-console drawer
- **AND** the page SHALL NOT render the "지원하지 않는 브라우저" notice

#### Scenario: Firefox user lands on the provision page

- **WHEN** an operator using Firefox navigates to the same URL
- **THEN** the page SHALL render a notice with Korean copy explaining that Chrome or Edge desktop is required
- **AND** the notice SHALL include a download link to `https://www.google.com/chrome/`
- **AND** the page SHALL NOT render the port picker or step checklist
- **AND** no `navigator.serial` API access SHALL be attempted

#### Scenario: Mobile browser user lands on the provision page

- **WHEN** an operator using Chrome on Android navigates to the same URL
- **THEN** the page SHALL render the same "지원하지 않는 브라우저" notice as Firefox

---

### Requirement: Port selection requires fresh user gesture per session

The provisioning page SHALL request the serial port via `navigator.serial.requestPort()` from a click handler each time the operator begins provisioning. The page SHALL NOT auto-select a previously granted port from `getPorts()`, even if exactly one such port exists.

#### Scenario: Operator clicks "포트 선택" and picks a port

- **WHEN** the operator clicks the "포트 선택" button
- **THEN** the browser SHALL display its native port-picker dialog
- **AND** upon the operator confirming a port, the page SHALL store the resulting `SerialPort` handle and enable the "셋업 시작" button

#### Scenario: Operator dismisses the picker

- **WHEN** the operator closes the picker without selecting a port (or `requestPort` rejects with `NotFoundError`)
- **THEN** the page SHALL remain in IDLE state
- **AND** the "셋업 시작" button SHALL remain disabled
- **AND** no audit log entry SHALL be written

---

### Requirement: Bootloader-mode boards auto-boot into application

If the initial probe (`?` followed by waiting for `^CLI>\s*`) times out within the configured `BOARD_PROBE_TIMEOUT_MS`, the provisioning flow SHALL automatically issue a `boot` command and wait up to `BOARD_BOOT_TIMEOUT_MS` for the application-mode prompt, without prompting the operator.

#### Scenario: Board is in bootloader mode

- **WHEN** the probe sends `?` and no line matching `^CLI>\s*` arrives within 3 seconds
- **THEN** the reducer SHALL transition to step `BOOTING_APP`
- **AND** the page SHALL send `boot\r\n`
- **AND** the page SHALL wait up to 5 seconds for the `CLI>` prompt
- **AND** upon receiving the prompt, the reducer SHALL transition to step `READING_DEVICE_INFO`

#### Scenario: Board boot fails

- **WHEN** the `boot` command is sent but no `CLI>` prompt arrives within 5 seconds
- **THEN** the reducer SHALL transition to `ERROR` with `failure.step = 'BOOTING_APP'` and a Korean failure message
- **AND** `gateway.recordProvisionFailure` SHALL be called

---

### Requirement: Provisioning halts immediately on the first failure

The provisioning flow SHALL stop sending further items as soon as any step fails (timeout, failure-regex match, write error, port-disconnect). It SHALL NOT auto-retry. The operator SHALL be presented with a red banner showing the failed step and reason, plus a "재시도" button that resets state to IDLE.

#### Scenario: Failure during certclient close

- **WHEN** the operator is in the middle of provisioning and the close command for `certclient` returns a line matching `BOARD_DEFAULT_FAILURE_REGEX`
- **THEN** the reducer SHALL transition to `ERROR` with `failure.step = 'SENDING_CERTCLIENT'` and `failure.reason` containing the matched line
- **AND** the page SHALL NOT send any commands for `certkey` or `reboot`
- **AND** `gateway.recordProvisionFailure` SHALL be called with `stepReached: 'SENDING_CERTCLIENT'`
- **AND** the page SHALL render a red banner with the failure detail and a "재시도" button

#### Scenario: Operator clicks 재시도

- **WHEN** the operator clicks the "재시도" button after a failure
- **THEN** the reducer SHALL transition to `IDLE`
- **AND** the previously opened port SHALL be closed and the handle discarded
- **AND** the operator SHALL be required to click "포트 선택" again before another attempt

---

### Requirement: Provisioning sends commands in fixed order, chunks certs safely, and reboots

The provisioning flow SHALL execute `BOARD_PROVISION_SEQUENCE` strictly in order. For `chunked` commands, it SHALL write the open command, wait `BOARD_OPEN_SETTLE_DELAY_MS`, write HEX lines from the bundle one at a time with `BOARD_INTER_CHUNK_DELAY_MS` between writes, write the close command, and wait up to `BOARD_CLOSE_TIMEOUT_MS` for a success or failure response. After the five settings items succeed, the flow SHALL send `reboot` and treat a successful write as flow completion (no read-after-reboot).

#### Scenario: Happy path completes all six commands in order

- **WHEN** the bundle is fetched, the port is open, and the board is in application mode
- **THEN** the page SHALL send commands in the order: `group_id <v>`, `broker <full-url>`, `certca set` + HEX chunks + `certca end`, `certclient set` + HEX chunks + `certclient end`, `certkey set` + HEX chunks + `certkey end`, `reboot`
- **AND** each chunked group SHALL write inter-chunk delays of 50 ms between HEX lines
- **AND** each chunked close SHALL be awaited for up to 15 seconds for a success line matching `BOARD_CHUNKED_SUCCESS_REGEX`
- **AND** after the `reboot` write succeeds, the reducer SHALL transition to `DONE`
- **AND** `gateway.recordProvisionSuccess` SHALL be called with `completedSteps` containing all six itemIds

#### Scenario: HEX line cannot exceed 200 characters

- **WHEN** the bundle from the server contains a HEX entry longer than 200 characters
- **THEN** the client SHALL throw before writing, with an error pointing to the offending entry
- **AND** the reducer SHALL transition to `ERROR` with `failure.step` set to the current chunked item and `failure.reason` containing 'HEX line exceeds 200 chars'

#### Scenario: Reboot does not block on response

- **WHEN** the `reboot` command is written successfully
- **THEN** the page SHALL NOT wait for any further read from the port
- **AND** the page SHALL transition to `DONE` and run the cleanup routine (cancel reader, close writer, close port) within 250 ms

---

### Requirement: Provisioning entry point lives on a minimal gateway detail page

The gateway list page SHALL link to a per-gateway detail page; the detail page SHALL contain the "보드에 설치" primary CTA that links to the provisioning page. The detail page SHALL render only the minimum information needed to give context for provisioning — no streaming, no sensor management, no historical telemetry.

#### Scenario: Operator navigates to a gateway detail page

- **WHEN** the operator clicks a gateway row in the gateway list
- **THEN** the browser SHALL navigate to `/orgs/[orgId]/projects/[projectId]/site-groups/[siteGroupId]/gateways/[gatewayId]`
- **AND** the page SHALL render the gateway's label, kind, mode, `endpointURL`, `groupId`, status badges, and certificate state ("발급됨" or "미발급")
- **AND** the page SHALL render a "보드에 설치" button

#### Scenario: Detail page disables CTA when certs are missing

- **WHEN** the gateway has any of its three encrypted PEM fields empty or null
- **THEN** the "보드에 설치" button SHALL be disabled
- **AND** a tooltip SHALL explain that certificates must be issued first
- **AND** the tooltip SHALL link to the gateway-edit dialog where the operator can either trigger auto-issuance or paste PEMs manually

---

### Requirement: Gateway dialog supports manual cert entry alongside auto-issuance

The existing `gateway-dialog.tsx` component (used for both create and edit) SHALL gain a collapsible "cert 수동 입력 (고급)" section containing three text areas: rootCa PEM, client cert PEM, client key PEM. The default workflow (auto-issue via `gateway.issueFromDaemon`) SHALL remain unchanged. If the operator fills the manual fields, those values SHALL be passed to the create/update mutation, where existing `encryptToken` calls already handle them.

#### Scenario: Operator creates a gateway with manual certs

- **WHEN** the operator opens the create dialog, expands the "cert 수동 입력" accordion, fills all three PEM fields with valid PEM strings, and submits
- **THEN** the `gateway.create` mutation SHALL receive the three PEM strings
- **AND** the server SHALL encrypt each with `encryptToken` and store as `rootCaPemEnc` / `clientCertPemEnc` / `clientKeyPemEnc`
- **AND** the new gateway SHALL be immediately eligible for provisioning (its detail page CTA SHALL be enabled)

#### Scenario: Operator partially fills manual cert fields

- **WHEN** the operator fills only one or two of the three PEM fields
- **THEN** the form SHALL display an inline validation error indicating all three are required together
- **AND** the submit button SHALL be disabled until all three are filled or all three are empty

#### Scenario: Operator pastes a malformed PEM

- **WHEN** any of the three filled fields fails to match `/-----BEGIN[^-]+-----[\s\S]+?-----END[^-]+-----/`
- **THEN** the form SHALL display an inline error pointing to the offending field

---

### Requirement: Audit logging captures provisioning lifecycle without exposing key material

For every provisioning attempt the system SHALL write at minimum two `AuditLog` rows: one with action `gateway.provision-start` at the moment the bundle is requested, and one with action `gateway.provision-success` or `gateway.provision-failed` at the moment the flow terminates. Metadata SHALL be structural only — `gatewayId`, optional `portName`, optional `deviceSerial`, `durationMs`, `completedSteps`, optional `stepReached`, `outcome`, optional `failureReason`. PEM bytes, HEX strings, key material, session tokens, and bundle contents SHALL NOT appear in any audit log row, server log, or telemetry payload.

#### Scenario: Successful provision writes start + success rows

- **WHEN** an operator completes a successful provision in 12 seconds
- **THEN** two `AuditLog` rows SHALL exist for the same `orgId` + `userId` + `targetId = gatewayId`
- **AND** the first SHALL have `action = 'gateway.provision-start'` and `metadata.outcome = 'INITIATED'`
- **AND** the second SHALL have `action = 'gateway.provision-success'`, `metadata.outcome = 'SUCCESS'`, `metadata.durationMs = 12000`, and `metadata.completedSteps` listing all six itemIds in order

#### Scenario: Failed provision writes start + failed rows

- **WHEN** an operator's provisioning fails at the `certclient` step after 6 seconds
- **THEN** two `AuditLog` rows SHALL exist
- **AND** the second SHALL have `action = 'gateway.provision-failed'`, `metadata.outcome = 'FAILURE'`, `metadata.stepReached = 'SENDING_CERTCLIENT'`, and `metadata.failureReason` containing the firmware response line

#### Scenario: No key material appears in any audit row

- **WHEN** any provisioning attempt completes (success or failure)
- **THEN** searching the resulting `AuditLog.metadata` JSON for the regex `/-----BEGIN |[0-9A-Fa-f]{100,}/` SHALL return zero matches across all rows written by this flow

---

### Requirement: Browser tab close mid-provisioning is handled gracefully

When the operator attempts to navigate away or close the tab while a provisioning is in progress (state.step ∉ { IDLE, DONE, ERROR }), the page SHALL prompt the operator with the browser's native unload confirmation. Regardless of the operator's choice, the cleanup routine SHALL run on `pagehide` (or component unmount): cancel the reader, close the writer, await both stream-closed promises, then call `port.close()`. The firmware's own 30-second cert-input timeout provides the device-side recovery if a chunked session was interrupted.

#### Scenario: Operator confirms leaving mid-flow

- **WHEN** state.step is `SENDING_CERTCA` and the operator triggers a browser navigation
- **THEN** the `beforeunload` listener SHALL return a truthy value, causing the browser to display its native "Leave site?" prompt
- **AND** if the operator confirms leaving, the page SHALL run the cleanup routine, releasing the serial port

#### Scenario: Operator cancels leaving

- **WHEN** the operator cancels the unload prompt
- **THEN** the provisioning flow SHALL continue from where it was
- **AND** no cleanup SHALL run

---

### Requirement: Warnings surface for previously-provisioned and running gateways

The provisioning page SHALL display non-blocking yellow warning banners when (a) the gateway has a non-null `lastProvisionedDeviceSerial`, or (b) the gateway's `desiredState === 'running'`. Neither warning SHALL prevent provisioning; both SHALL clearly explain the consequence so the operator can make an informed choice.

#### Scenario: Re-provisioning warning

- **WHEN** the operator opens the provision page for a gateway whose `lastProvisionedDeviceSerial = 'STM32-XYZ'` and `lastProvisionedAt = '2026-04-10T09:15:00Z'`
- **THEN** the page SHALL render a yellow banner: "이 게이트웨이는 2026-04-10 18:15 에 serial=STM32-XYZ 에 설치된 적이 있습니다. 새 보드에 다시 설치하시겠습니까?"
- **AND** the "셋업 시작" button SHALL remain enabled

#### Scenario: Running-state warning

- **WHEN** the operator opens the provision page for a gateway whose `desiredState === 'running'`
- **THEN** the page SHALL render a yellow banner: "이 게이트웨이는 현재 running 상태입니다. 설치 후 자동 reboot 되어 새 설정으로 재연결됩니다."
- **AND** the "셋업 시작" button SHALL remain enabled

---

### Requirement: Serial port access is abstracted for testability

The client code SHALL access serial ports only through a `SerialPortAdapter` interface defined in `apps/web/lib/board-cli/serial-port-adapter.ts`. The production implementation SHALL wrap `navigator.serial`. The test implementation SHALL be a `MockSerialPortAdapter` driven by a scripted set of input-match → output-emit rules. The adapter resolver SHALL prefer `globalThis.__SERIAL_ADAPTER__` if defined (for Playwright injection) and fall back to the production adapter otherwise.

#### Scenario: Production adapter is selected by default

- **WHEN** the provision page mounts in a browser without `globalThis.__SERIAL_ADAPTER__` defined
- **THEN** `getSerialPortAdapter()` SHALL return the `webSerialAdapter` singleton
- **AND** `webSerialAdapter.requestPort()` SHALL delegate to `navigator.serial.requestPort()`

#### Scenario: Test injection wins

- **WHEN** a test sets `globalThis.__SERIAL_ADAPTER__ = mockAdapter` before the page mounts
- **THEN** `getSerialPortAdapter()` SHALL return `mockAdapter`
- **AND** the page's `requestPort()` call SHALL go through `mockAdapter`, never touching `navigator.serial`

#### Scenario: Mock adapter drives full happy path

- **WHEN** a test mounts the provision page with `MockSerialPortAdapter` configured with `happyPathScript()` and triggers the full flow
- **THEN** the reducer SHALL traverse all defined steps to `DONE`
- **AND** every command in `BOARD_PROVISION_SEQUENCE` SHALL appear in the mock's recorded write log in order
- **AND** no real serial port SHALL be opened

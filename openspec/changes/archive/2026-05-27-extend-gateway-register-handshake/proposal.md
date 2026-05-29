# Change: Extend gateway-board-provisioning with register handshake + tailing-sensor auto-discovery

## Why

The existing `gateway-board-provisioning` capability (archived change `add-gateway-board-provisioning`) gives operators a one-click way to flash a Gateway row's certs + groupId + broker endpoint onto a USB-connected STM32 board over Web Serial. That spec ends at "board reboots and connects to the broker." It does not:

1. **Fetch the board's real identity back.** The spec writes config FORWARD to the board but never reads the board's STM32 24-hex unique ID (e.g. `2C004A001351353230363438`) BACK into the Gateway row. Today, `Gateway.lastProvisionedDeviceSerial` is recorded only if the operator types it in or the board CLI happens to echo it during the existing sequence — there's no dedicated `GET` command in the protocol.
2. **Discover the board's downstream children.** The pasted board CLI output shows DAEJAK firmware enumerates RS-485 children verbatim (`Registered: 1  [1] 0B0003000F5355533936302D  type=DAEJAK_VM`). The current spec ignores this — operators must drop each tailing sensor manually on the canvas, then guess its address, then hope it matches what the board sees.
3. **Atomically swap shadow → real UUIDs.** With spec 2 (`add-unregistered-device-lifecycle`) introducing the `shadowUuid` / `realUuid` alias pair on every Device row, registration needs a transactional step that flips `registrationState: UNREGISTERED → REGISTERING → REGISTERED`, stamps `realUuid` from the board's reported ID, stops simulation, and cascades to all child Device rows discovered on the gateway's RS-485 bus.
4. **Handle re-registration.** When an operator physically swaps a gateway board, the canvas node should keep its `deviceKey` (immutable) and `shadowUuid` (historical) but receive a new `realUuid`, new cert fingerprint, new audit row. There's no UX for this today.

This change extends the existing `gateway-board-provisioning` capability with the missing FETCH + DISCOVER + COMMIT half of the flow, plus the cascade to child Device rows.

The user explicitly chose: **Web Serial only for v1** (no network-based register channel), **per-sensor checklist with auto-match suggestions** for the discovery UX, **all-or-nothing per gateway** error/retry semantics, and **explicit Re-register button** for board swap (with the canvas node's `deviceKey` preserved).

## What Changes

This change MODIFIES the existing `gateway-board-provisioning` capability spec (it does not create a new capability). New protocol commands are added to the Web Serial CLI mapping; new tRPC procedures are added to the `gateway` router; a new register-flow UX is added under the existing gateways detail page.

The board firmware's CLI was confirmed FIXED on the legacy `modules/...` topic tree, so this change does NOT push a new topic schema. The topic-schema migration is spec 4. This change focuses purely on **identity rewrite + downstream discovery** at the Device row layer.

- **MODIFIED CAPABILITY SPEC** `gateway-board-provisioning` — adds requirements for `status` CLI parsing, child enumeration parsing, auto-match algorithm, COMMIT/ABORT semantics, tab-close transactional rollback, re-registration of swapped boards.

- **NEW tRPC PROCEDURES** in `packages/api/src/routers/gateway.ts`:
  - `gateway.beginRegistration({ orgId, gatewayDeviceKey })` — server-side state transition: flip the gateway Device row to `REGISTERING`; flip all downstream Devices (where `parentDeviceKey === gateway.deviceKey`) to `REGISTERING` so their simulators stop accepting config edits; return a `registrationSessionId` (CUID) that subsequent calls quote.
  - `gateway.proposeRegistration({ orgId, gatewayDeviceKey, registrationSessionId, boardReportedUuid, discoveredChildren: DiscoveredChild[] })` — accepts the board's reported real UUID and the parsed RS-485 child list; runs the auto-match algorithm; returns a proposal `{ gatewayMatch: { realUuid }, childMatches: ChildMatch[], unmatchedShadows: Device[], extraChildren: DiscoveredChild[], unknownTypes: DiscoveredChild[] }`. Persists the proposal under a new `RegistrationProposal` row for COMMIT.
  - `gateway.commitRegistration({ orgId, gatewayDeviceKey, registrationSessionId, decisions: RegistrationDecisions })` — atomically: stamps `realUuid` on the gateway Device row and every matched child Device row; creates new child Device rows for extras the user accepted; soft-archives unmatched shadows the user chose to delete; flips all to `REGISTERED`; stops simulation; writes audit rows. Returns the final post-commit DB state.
  - `gateway.abortRegistration({ orgId, gatewayDeviceKey, registrationSessionId, reason })` — rolls back: flips `REGISTERING → UNREGISTERED` on the gateway + all children; deletes the `RegistrationProposal` row; writes audit row with action `gateway.register-aborted`.
  - `gateway.recordRegisteredSerial({ orgId, gatewayDeviceKey, registrationSessionId, boardSerial, durationMs, completedSteps[] })` — extends the existing audit pattern; adds rows under action `gateway.register-success` (or `…-failed`) with the full before/after `realUuid` pair, the matched-children digest, and the cert fingerprint that was already issued by the prior provisioning step.

- **NEW PRISMA MODEL** `RegistrationProposal`:
  - `id String @id` (CUID = registrationSessionId).
  - `gatewayDeviceKey String` (FK).
  - `boardReportedUuid String` (the 24-hex STM32 ID).
  - `discoveredChildrenJson Json` (raw parsed entries from `LIST_CHILDREN` / `status` output).
  - `matchPlanJson Json` (the auto-match output the server proposed).
  - `userDecisionsJson Json?` (set on COMMIT or ABORT).
  - `state RegistrationProposalState` enum: `PROPOSED | COMMITTED | ABORTED | EXPIRED`.
  - `createdAt`, `committedAt`, `abortedAt`.
  - `@@index([gatewayDeviceKey, state])`. Auto-expire after 30 minutes via a job that flips `PROPOSED` rows to `EXPIRED` and resets the parent gateway state.

- **NEW WEB SERIAL CLI COMMANDS** (extend `packages/api/src/lib/board-cli-spec.ts`):
  - `status` — already exists on the board (per the pasted output). The web client SHALL send `status\n`, capture the multi-line response, and run it through a new parser `parseStatusOutput(raw: string): ParsedBoardStatus` returning `{ boardId, firmware, mqtt: { broker, port, clientId, subs[] }, mqttGroup: { groupId, edgeNodeId, collectionPeriod, collectionAlign }, bus485: { children: DiscoveredChild[] } }`. The parser SHALL be a pure function.
  - `bus485 rescan` (new CLI verb on the firmware side — out of scope for this spec, but the web client MAY optionally send it before parsing `status` for a fresh enumeration). For v1, the web client uses the existing `status` output AS-IS without forcing a rescan.
  - No new firmware-side commands are required for the v1 register flow; the existing `status` output contains everything we need. The Web Serial extensions are purely client-side parsers + flow logic.

- **NEW CLIENT MODULES** under `apps/web/lib/board-cli/`:
  - `parse-status-output.ts` — TypeScript parser for the multi-line `status` CLI reply. Pure function, ≤ 1ms for typical (≤ 8KB) input.
  - `parse-discovered-child.ts` — pure function decoding `0B0003000F5355533936302D` into `{ address: 11, firmwareTypeCode: '0003000F', serialAscii: 'SUS960-' }` (the layout the user confirmed in interview round 3).
  - `register-reducer.ts` — `useReducer` state machine for the register flow: `IDLE → CONNECTING → READING_STATUS → PROPOSING → AWAITING_USER_DECISION → COMMITTING → DONE | FAILED | ABORTED`. Each state carries the relevant payload (parsed status, server proposal, user decisions).

- **NEW PAGES / COMPONENTS** under `apps/web/app/(app)/orgs/[orgId]/projects/[projectId]/site-groups/[siteGroupId]/gateways/[gatewayId]/`:
  - `register/page.tsx` — the register flow, distinct from the existing `provision/page.tsx`. Reuses Web Serial adapter + `cli-session` from the existing spec. Walks the user through: browser-compat gate → port picker → status read → match proposal (per-sensor checklist) → confirm/edit → COMMIT.
  - `register-proposal-table.tsx` — the per-sensor checklist UI: rows for each `(shadowDevice ↔ discoveredChild)` match, each with confidence indicator (auto-match score), a swap-target dropdown (other shadow Devices on the same gateway, "Create new node"), and a checkbox to confirm / skip. Bulk-confirm shortcut at the top.
  - `unmatched-shadows-panel.tsx` — for shadows the auto-matcher couldn't pair: each gets actions "Keep simulated" (no-op), "Soft-archive" (set ORPHANED), "Convert to canvas-only manual entry" (no register, but remain in canvas as `UNREGISTERED`).
  - `extra-children-panel.tsx` — for discovered children the canvas doesn't yet model: each gets a manifest picker (by category=sensor + accepted protocols from the gateway's port spec) + a checkbox to "Auto-create canvas node" (which calls `device.create` and a small canvas-store mutation that places the new node beside the gateway).
  - `unknown-types-panel.tsx` — for discovered children whose `firmwareTypeCode` doesn't map to any manifest's `firmwareTypeIds[]`: each row blocks the register with "Unknown device type. Add a manifest first." and a link to the device-type-authoring docs.
  - `re-register-banner.tsx` — shown when `Gateway.lastProvisionedDeviceSerial !== null` (already registered): explains "Re-registration will revoke the existing cert and issue a new one." Requires explicit confirmation checkbox before the COMMIT button enables.

- **NEW AUTO-MATCH LOGIC** in `packages/api/src/lib/registration-matcher.ts`:
  - `proposeRegistrationMatch(gatewayDeviceKey, discoveredChildren): MatchPlan` runs the prioritized signal list the user specified in interview round 3:
    1. Exact `manifest.firmwareTypeIds` match against `discoveredChild.firmwareTypeCode`.
    2. Port + address match against existing `Device.portBindings`.
    3. Order-within-port (1st discovered child on rs485-1 → 1st shadow on rs485-1).
    4. Manual label match (shadow `Device.config.label` substring vs `discoveredChild.serialAscii`).
    5. Last-known mapping from the last successful `RegistrationProposal.userDecisionsJson` for this gateway, if any.
  - Each match carries a `confidence: 'EXACT' | 'PORT_AND_ADDRESS' | 'ORDER_FALLBACK' | 'LABEL_HEURISTIC' | 'LAST_KNOWN' | 'NONE'`. Multiple matches resolve in priority order; ties broken by lowest shadow `createdAt`.

- **MODIFIED MIDDLE PAGES** the gateway detail page (`gateways/[gatewayId]/page.tsx`):
  - Adds a "Register Device" primary button (alongside the existing "보드에 설치" install button). Disabled when `Gateway.lastProvisionedDeviceSerial === null` AND `Gateway.deviceKey === null` (i.e. the gateway hasn't yet been provisioned via the existing flow).
  - Enabled in two states: (a) **first registration** — text "Register Device", routes to `/register?mode=new`; (b) **re-registration** — text "Re-register Board", routes to `/register?mode=re-register&previousSerial=<lastProvisionedDeviceSerial>`.

- **MODIFIED AUDIT ACTIONS**: add `gateway.register-start`, `gateway.register-proposed`, `gateway.register-success`, `gateway.register-failed`, `gateway.register-aborted`, `gateway.re-register-start`. Metadata SHALL include `before/after realUuid pair` for the gateway and a digest of `before/after realUuid` pairs for every cascaded child.

- **NEW PRISMA MIGRATION** named `add-registration-proposal` — adds the `RegistrationProposal` model and enum.

- **NEW TESTS**:
  - Unit (`parse-status-output.spec.ts`, `parse-discovered-child.spec.ts`) — multiple golden snapshots from real board output (the user's CLI dump plus variants).
  - Unit (`registration-matcher.spec.ts`) — every confidence level + tie-breaking + last-known reuse.
  - Integration (`gateway.spec.ts` extension) — full begin/propose/commit/abort cycle against a seeded DB; idempotency of commit on retry; abort rollback.
  - UI (`register-flow.spec.tsx`) — happy path through reducer + mock Web Serial; mismatch panels render and route through `commit`.
  - E2E (Playwright, mock adapter) — drop a `daejak-main-v1` + two `daejak-vm` shadows, run provisioning, then register, observe canvas badges flip from Unregistered → Registered with realUuids populated.

## Impact

- **Affected specs**: MODIFIES existing capability `gateway-board-provisioning`. Depends on `add-plugin-device-type-registry` (for `firmwareTypeIds` lookup) and `add-unregistered-device-lifecycle` (for the Device table + state machine).
- **Affected code**:
  - `packages/db/prisma/schema.prisma` — `RegistrationProposal` model + enum.
  - `packages/api/src/routers/gateway.ts` — 4 new procedures (begin/propose/commit/abort) + audit extension.
  - `packages/api/src/lib/registration-matcher.ts` — NEW.
  - `packages/api/src/lib/board-cli-spec.ts` — extended with `status` command + parser invocations (parsing is client-side but the command sequence is shared).
  - `apps/web/lib/board-cli/` — three new pure modules (`parse-status-output`, `parse-discovered-child`, `register-reducer`).
  - `apps/web/app/(app)/.../gateways/[gatewayId]/register/page.tsx` — NEW.
  - `apps/web/components/canvas/canvas-store.ts` — small action to insert auto-created canvas nodes from the "extras" panel.
- **Affected user UX**:
  - The gateway detail page gains a second primary CTA ("Register Device" / "Re-register Board").
  - The register flow is a guided wizard with the per-sensor checklist; bulk-confirm available.
  - Canvas nodes auto-flip from Unregistered → Registered visually within ~1s of COMMIT.
- **Non-goals**:
  - Network-based registration (Web Serial only in v1).
  - Bulk multi-gateway register (one at a time).
  - Firmware-side rescan commands (`bus485 rescan`) — the v1 flow uses the existing `status` output.
  - Cert rotation outside of the re-registration explicit click.
  - OPC-UA / LoRaWAN tailing-sensor discovery (RS-485 only in v1; matches the protocols list).
- **Risk surface**:
  - The `status` CLI output format is firmware-specific (DAEJAK). Parsing failures MUST surface clearly — never silently match or skip a child.
  - The COMMIT step writes to many rows (gateway + N children + cert + audit). Wrapped in a single Prisma transaction; failure mode is rollback to `REGISTERING` (user retries).
  - Tab-close mid-flow leaves the Device rows in `REGISTERING`. The 30-minute auto-expire job recovers them; manual recovery via `abortRegistration` is also exposed in the gateway detail page when state is stuck.

# gateway-board-provisioning Specification (delta)

## ADDED Requirements

### Requirement: The board CLI `status` output SHALL be the SOLE source of truth for register-time identity and child enumeration

The Web Serial register flow SHALL invoke the existing board CLI command `status\n`, capture the multi-line response, and parse it through the pure function `parseStatusOutput(raw: string): ParsedBoardStatus`. The parser SHALL extract:

- `[Board Status]` section → `boardId` (the STM32 24-hex unique ID, used as the device's `realUuid`), `boardType`, `firmware` label, `state`, `rtcTime`.
- `[MQTT Status]` section → `connected`, `broker`, `port`, `clientId`, `subs[]`.
- `[MQTT]` section → `groupId`, `edgeNodeId`, `collectionPeriod`, `collectionAlign`.
- `[485 Bus Status]` section → `children: DiscoveredChild[]` parsed via `parseDiscoveredChild`.

No new firmware-side commands SHALL be required for the v1 register flow. Unrecognised lines within a recognised section SHALL be appended to `_unparsed: string[]` on the result; they SHALL NOT cause parsing to fail.

#### Scenario: Operator's exact paste parses to expected structure

- **WHEN** `parseStatusOutput` is called with the multi-line raw text:
  ```
  [Board Status]
    Board ID:    2C004A001351353230363438
    Board Type:  MAIN
    Firmware     DAEJAK_MAIN v1.2.0
    IP Address:  192.168.39.71
    State:       NORMAL
    RTC Time:    2026-05-27 17:54:54

  [MQTT Status]
    connected: connected
    broker:   mqtts://api.52-79-241-139.nip.io:8883
    port:     8883
    clientid: 2C004A001351353230363438
    subs:     2 topic(s)
      [1] modules/modules/NCMD/2C004A001351353230363438
      [2] modules/modules/DCMD/2C004A001351353230363438/+

  [MQTT]
    group_id:      modules
    edge_node_id:  2C004A001351353230363438
    collection_period:     600 sec
    collection_align:      on

  [485 Bus Status]
    Registered: 1
    [1] 0B0003000F5355533936302D  type=DAEJAK_VM
  ```
- **THEN** the result SHALL contain `boardId = '2C004A001351353230363438'`, `firmware = 'DAEJAK_MAIN v1.2.0'`, `mqtt.broker = 'mqtts://api.52-79-241-139.nip.io:8883'`, `mqtt.subs.length = 2`, `mqttGroup.groupId = 'modules'`, `bus485.children.length = 1`
- **AND** `bus485.children[0]` SHALL equal `{ raw: '0B0003000F5355533936302D', address: 11, firmwareTypeCode: '0003000F', serialAscii: 'SUS960-', reportedTypeLabel: 'DAEJAK_VM', portId: 'rs485-1' }`
- **AND** `_unparsed` SHALL be empty

#### Scenario: Missing 485 Bus section returns empty children array, not an error

- **WHEN** the input lacks the `[485 Bus Status]` section entirely
- **THEN** the result's `bus485.children` SHALL be `[]`
- **AND** the parser SHALL NOT throw

#### Scenario: Child entry with wrong length is reported

- **WHEN** the line is `[1] 0B0003000F  type=BAD_TYPE` (12 hex chars instead of 24)
- **THEN** `parseDiscoveredChild('0B0003000F', 'BAD_TYPE')` SHALL return `null` and the parser SHALL include `{ raw: '0B0003000F', reason: 'length_mismatch_expected_24_got_10', reportedTypeLabel: 'BAD_TYPE' }` in `bus485._invalidChildren`
- **AND** the rest of the parse SHALL complete without throwing

---

### Requirement: `gateway.beginRegistration` SHALL atomically flip the gateway and all child Device rows to REGISTERING

The tRPC procedure `gateway.beginRegistration({ orgId, gatewayDeviceKey })` SHALL, in a single Prisma transaction:

1. Verify the caller is a member of the gateway's org.
2. Assert `Device.registrationState ∈ { 'UNREGISTERED', 'REGISTERED' }` for the gateway row. (REGISTERED means a re-registration is starting.)
3. Update the gateway Device row's `registrationState = 'REGISTERING'`.
4. Update every Device row where `parentDeviceKey = gatewayDeviceKey` from `UNREGISTERED → REGISTERING` and from `REGISTERED → REGISTERING` (the second case during re-registration).
5. Insert a new `RegistrationProposal` row with `state = 'PROPOSED'`, `expiresAt = NOW() + 30 minutes`, `gatewayDeviceKey`, `boardReportedUuid = ''` (filled in by proposeRegistration), `discoveredChildrenJson = []`, `matchPlanJson = {}`.
6. Write an `AuditLog` row action `gateway.register-start`.
7. Return `{ registrationSessionId: <new proposal id> }`.

If a `RegistrationProposal` already exists in `state = 'PROPOSED'` for this gateway and has not expired, the procedure SHALL return that existing session's id instead of creating a new row (idempotent within session).

#### Scenario: Begin transitions gateway + children to REGISTERING

- **GIVEN** a Device row gw1 in state `UNREGISTERED` with 3 child Devices c1, c2, c3 (each `parentDeviceKey = gw1.deviceKey`, state `UNREGISTERED`)
- **WHEN** `gateway.beginRegistration({ gatewayDeviceKey: gw1.deviceKey })` succeeds
- **THEN** gw1.registrationState SHALL be `REGISTERING`
- **AND** c1.registrationState, c2.registrationState, c3.registrationState SHALL all be `REGISTERING`
- **AND** a `RegistrationProposal` row SHALL exist with `gatewayDeviceKey = gw1.deviceKey`, `state = 'PROPOSED'`, `expiresAt > NOW() + 25 min`
- **AND** an `AuditLog` row action `gateway.register-start` SHALL exist

#### Scenario: Concurrent begin returns existing session

- **GIVEN** an active `PROPOSED` RegistrationProposal exists for gw1 (created < 30 min ago)
- **WHEN** the user (or a duplicate API call) invokes `beginRegistration` again
- **THEN** the procedure SHALL return the existing session's id
- **AND** no new RegistrationProposal row SHALL be inserted
- **AND** no extra `AuditLog` row SHALL be written

---

### Requirement: `gateway.proposeRegistration` SHALL persist a match plan and return it for user review

`gateway.proposeRegistration({ orgId, gatewayDeviceKey, registrationSessionId, boardReportedUuid, discoveredChildren })` SHALL:

1. Verify the proposal exists and is `state = 'PROPOSED'`.
2. Verify `boardReportedUuid` matches `/^[0-9A-F]{24}$/` (STM32 24-hex format).
3. Verify each discovered child has `raw` of exactly 24 hex chars; reject the call if any does not (caller MUST pre-filter).
4. Run `proposeRegistrationMatch` from `packages/api/src/lib/registration-matcher.ts` with the shadow Devices currently parented to the gateway plus the discovered children and the prior proposal's `userDecisionsJson` if a previous `COMMITTED` row exists for this gateway.
5. Update the proposal row with `boardReportedUuid`, `discoveredChildrenJson`, `matchPlanJson`.
6. Write `AuditLog` action `gateway.register-proposed` with the proposal's id and the match plan's summary digest.
7. Return `{ matchPlan, unmatchedShadows, extraChildren, unknownTypes }`.

#### Scenario: Propose persists match plan and returns it

- **GIVEN** an active proposal for gw1 with 2 shadow children s1, s2; the board reports 2 discovered children with matching firmwareTypeCodes
- **WHEN** `proposeRegistration` is invoked with valid args
- **THEN** the returned `matchPlan.childMatches` SHALL have length 2
- **AND** each match's `confidence` SHALL be `EXACT`
- **AND** the persisted `RegistrationProposal.matchPlanJson` SHALL be the same value as returned
- **AND** `unmatchedShadows`, `extraChildren`, `unknownTypes` SHALL all be empty arrays

#### Scenario: Unknown firmware type surfaces in unknownTypes and is NOT auto-mapped

- **GIVEN** the registry contains no manifest with `firmwareTypeIds` including `'DAEJAK_UNKNOWN'`
- **AND** the board reports one child whose `reportedTypeLabel = 'DAEJAK_UNKNOWN'`
- **WHEN** `proposeRegistration` is invoked
- **THEN** the returned `unknownTypes` SHALL contain that discovered child
- **AND** `matchPlan.childMatches` SHALL NOT reference it
- **AND** the proposal row SHALL persist the same shape

#### Scenario: Invalid boardReportedUuid is rejected

- **WHEN** `proposeRegistration` is invoked with `boardReportedUuid = 'short'`
- **THEN** the procedure SHALL throw `TRPCError({ code: 'BAD_REQUEST' })` whose message references the expected format
- **AND** the proposal row SHALL be unchanged

---

### Requirement: `gateway.commitRegistration` SHALL execute all identity rewrites in a single Prisma transaction

`gateway.commitRegistration({ orgId, gatewayDeviceKey, registrationSessionId, decisions })` SHALL execute the following in a single `prisma.$transaction`:

1. Re-verify the proposal exists, is `state = 'PROPOSED'`, and has not expired (`expiresAt > NOW()`).
2. Refuse commit when `decisions` references any unknown-type entry from the proposal.
3. UPDATE the gateway Device row: set `realUuid = proposal.boardReportedUuid`, `registrationState = 'REGISTERED'`, `simulationDesired = false`, `registeredAt = NOW()`, `registeredByUserId = ctx.user.id`.
4. UPDATE each confirmed-match child Device row: set `realUuid = match.discovered.raw`, `registrationState = 'REGISTERED'`, `simulationDesired = false`, `registeredAt = NOW()`, `registeredByUserId = ctx.user.id`, `portBindings = [match.proposedPortBindings]`, `deviceTypeId = match.resolvedDeviceTypeId` (this is the manifest-upgrade path — e.g. a `core-generic-sensor` shadow upgrades to `daejak-vm` once we know the real firmware).
5. INSERT one new Device row per accepted-extra entry, plus append a corresponding xyflow node to the active NodeConfig version.
6. For each rejected shadow: apply the user-chosen action (`soft-archive` → `ORPHANED`, `keep-simulated` → `UNREGISTERED`, `keep-as-manual` → `UNREGISTERED` with `simulationDesired = false`).
7. UPDATE the RegistrationProposal: `state = 'COMMITTED'`, `committedAt = NOW()`, `userDecisionsJson = decisions`.
8. INSERT `AuditLog` rows: one `gateway.register-success` per registered Device with `{ before: { realUuid, registrationState }, after: { realUuid, registrationState } }` metadata, plus one summary row keyed to the gateway.

If any step throws, the entire transaction SHALL roll back; Devices remain in `REGISTERING`; the proposal remains `PROPOSED`; the user may retry. The procedure SHALL be idempotent on retry only when the previous attempt did not write any Audit rows (transaction-internal idempotency is guaranteed by the rollback).

#### Scenario: Happy-path commit updates gateway + all matched children

- **GIVEN** a proposal in `PROPOSED` state with 1 gateway match + 3 child matches + 0 extras + 0 unknowns + 0 rejected
- **WHEN** `commitRegistration` succeeds
- **THEN** the gateway Device row SHALL have `realUuid = <boardReportedUuid>`, `registrationState = 'REGISTERED'`, `simulationDesired = false`
- **AND** each of the 3 child Device rows SHALL have `realUuid = <matched.raw>`, `registrationState = 'REGISTERED'`, `simulationDesired = false`
- **AND** the proposal row SHALL be `state = 'COMMITTED'`, `committedAt` populated, `userDecisionsJson` set
- **AND** at least 5 `AuditLog` rows SHALL be written (1 summary + 4 per-device)

#### Scenario: Commit blocked while any unknown-type lingers in decisions

- **GIVEN** the proposal's `unknownTypes` array is non-empty
- **WHEN** `commitRegistration` is invoked with decisions that DO NOT instruct removal of the unknowns from the canvas
- **THEN** the procedure SHALL throw `TRPCError({ code: 'FAILED_PRECONDITION', message: <Korean message naming the unknown type> })`
- **AND** no rows SHALL be mutated

#### Scenario: Commit rolls back on partial failure

- **GIVEN** the third child UPDATE statement would violate a constraint (e.g. malformed deviceTypeId after manifest removal mid-flow)
- **WHEN** `commitRegistration` is invoked
- **THEN** the transaction SHALL roll back
- **AND** the gateway Device row's `registrationState` SHALL remain `REGISTERING`
- **AND** the proposal row SHALL remain `state = 'PROPOSED'`
- **AND** no `AuditLog` row of action `gateway.register-success` SHALL exist

---

### Requirement: `gateway.abortRegistration` SHALL reverse the REGISTERING transitions

`gateway.abortRegistration({ orgId, gatewayDeviceKey, registrationSessionId, reason })` SHALL:

1. Verify the proposal exists and is `state = 'PROPOSED'`.
2. Update the gateway Device row from `REGISTERING → UNREGISTERED` (or `REGISTERED` if a re-register session is being aborted before the cert was revoked).
3. Update every child Device row from `REGISTERING → UNREGISTERED` (or `REGISTERED` for re-register).
4. Update the proposal: `state = 'ABORTED'`, `abortedAt = NOW()`, `userDecisionsJson = { aborted: true, reason }`.
5. Write `AuditLog` action `gateway.register-aborted` with metadata `{ reason }`.

#### Scenario: Abort cleanly restores prior states

- **GIVEN** an active proposal during a FIRST-time registration (gateway started in `UNREGISTERED`)
- **WHEN** `abortRegistration({ reason: 'user-cancel' })` is invoked
- **THEN** the gateway and all children SHALL return to `UNREGISTERED`
- **AND** the proposal SHALL be `state = 'ABORTED'`
- **AND** no Device row SHALL have a non-null `realUuid` set as a side effect of the abort

#### Scenario: Abort during re-registration restores prior REGISTERED state

- **GIVEN** an active proposal during a RE-REGISTER (gateway started in `REGISTERED` with `realUuid = 'X'`)
- **WHEN** `abortRegistration` is invoked before the cert was revoked
- **THEN** the gateway SHALL return to `registrationState = 'REGISTERED'` with `realUuid = 'X'` unchanged
- **AND** all children SHALL similarly return to `REGISTERED`

---

### Requirement: Stale RegistrationProposal rows SHALL be auto-expired and the parent gateway recovered

A scheduled job `registration-proposal-expire` SHALL run every 5 minutes. For each `RegistrationProposal` with `state = 'PROPOSED' AND expiresAt < NOW()`, the job SHALL:

1. UPDATE the proposal to `state = 'EXPIRED'`.
2. UPDATE the parent gateway + all children whose `registrationState = 'REGISTERING'` to the appropriate prior state — `UNREGISTERED` if the gateway was un-registered at begin time, or `REGISTERED` for re-register sessions. This is determined by looking at the audit row that initiated the session (`gateway.register-start` metadata includes the prior state).
3. INSERT an `AuditLog` row action `gateway.register-expired` with `{ registrationSessionId, durationSecs }`.

#### Scenario: Expire after 30 minutes resets a stuck session

- **GIVEN** a `RegistrationProposal` created 35 minutes ago, `state = 'PROPOSED'`
- **AND** the gateway and 2 children remain in `REGISTERING`
- **WHEN** the `registration-proposal-expire` job runs
- **THEN** the proposal SHALL be flipped to `EXPIRED`
- **AND** the gateway + 2 children SHALL be flipped back to `UNREGISTERED`
- **AND** an `AuditLog` row action `gateway.register-expired` SHALL be written

---

### Requirement: Re-registration SHALL revoke the existing cert and issue a fresh cert as part of commit

The system SHALL detect re-registration sessions by inspecting whether the gateway Device row's `realUuid !== null` at proposal-commit time. In that case the commit procedure SHALL execute the following extra steps:

1. The procedure SHALL call `daemon.DELETE /v1/tenants/{tenantId}/certs/{currentFingerprint}` to revoke the existing cert. If the daemon returns 404/405/501, the call SHALL be treated as soft-success ("daemon does not support revocation") and the commit SHALL proceed.
2. The procedure SHALL call the existing `gateway.issueFromDaemon` flow to obtain a fresh cert. The new cert SHALL be encrypted and stored on the Gateway runtime row.
3. The transaction SHALL update the Device row's `realUuid` to the new `boardReportedUuid`, and the audit row SHALL include `previousRealUuid` and `previousCertFingerprint` for forensic linkage.

#### Scenario: Re-register revokes prior cert and issues a new one

- **GIVEN** a gateway Device row with `realUuid = '2C00...AAA'` and corresponding Gateway runtime row with cert fingerprint `'AA:BB:CC'`
- **WHEN** the user re-registers and the new board reports `realUuid = '2C00...BBB'`
- **THEN** the daemon `DELETE /v1/tenants/{tenantId}/certs/AA:BB:CC` SHALL be invoked
- **AND** a fresh cert SHALL be issued (existing `gateway.issueFromDaemon` flow)
- **AND** the Device row SHALL have `realUuid = '2C00...BBB'`
- **AND** the `AuditLog` row action `gateway.re-register-success` SHALL include `previousRealUuid = '2C00...AAA'`, `previousCertFingerprint = 'AA:BB:CC'`, `newCertFingerprint = <issued>`

---

### Requirement: The match algorithm SHALL prioritize signals in this exact order: EXACT → PORT_AND_ADDRESS → ORDER_FALLBACK → LABEL_HEURISTIC → LAST_KNOWN

`proposeRegistrationMatch(shadows, discovered, lastKnown?)` SHALL evaluate candidates in five priority passes; only previously-unmatched entries are eligible at each pass:

1. **EXACT**: shadow's manifest's `firmwareTypeIds[]` includes `discovered.reportedTypeLabel`.
2. **PORT_AND_ADDRESS**: shadow's `portBindings[0].address === discovered.address` AND shadow's parent port id matches `discovered.portId`.
3. **ORDER_FALLBACK**: among remaining shadows on the same parent port, pair to remaining discovered children by ascending `discovered.address`.
4. **LABEL_HEURISTIC**: shadow's `config.label` (if present) is a case-insensitive substring of `discovered.serialAscii` OR vice versa.
5. **LAST_KNOWN**: prior `userDecisionsJson.confirmedMatches[]` from the most recent `COMMITTED` proposal pairs this shadow with this discovered raw value.

Within each pass, ties SHALL be resolved by lowest shadow `createdAt` ASCENDING.

#### Scenario: EXACT match overrides ORDER_FALLBACK

- **GIVEN** two shadows: s1 (deviceTypeId `daejak-vm`, no portBindings) and s2 (deviceTypeId `core-generic-sensor`, no portBindings), both created at the same time
- **AND** one discovered child d1 with `reportedTypeLabel = 'DAEJAK_VM'`
- **WHEN** `proposeRegistrationMatch` runs
- **THEN** s1 SHALL be paired with d1 via `confidence = 'EXACT'`
- **AND** s2 SHALL be in `unmatchedShadows`

#### Scenario: PORT_AND_ADDRESS wins over ORDER_FALLBACK

- **GIVEN** two shadows s1, s2 both with `deviceTypeId: 'core-generic-sensor'`; s1 has `portBindings: [{ parentPortId: 'rs485-1', address: 12 }]`; s2 has no portBindings; both created at the same time
- **AND** two discovered children d1 (`address: 5`) and d2 (`address: 12`)
- **WHEN** `proposeRegistrationMatch` runs
- **THEN** s1 SHALL be paired with d2 via `confidence = 'PORT_AND_ADDRESS'`
- **AND** s2 SHALL be paired with d1 via `confidence = 'ORDER_FALLBACK'`

#### Scenario: LAST_KNOWN reuses prior mapping

- **GIVEN** a previous COMMITTED proposal whose `userDecisionsJson.confirmedMatches` contains `{ shadowDeviceKey: 's3', discoveredRaw: 'XYZ' }`
- **AND** no higher-priority match applies to s3 in the current pool
- **AND** discovered children include one with `raw = 'XYZ'`
- **WHEN** `proposeRegistrationMatch` runs
- **THEN** s3 SHALL be paired with that discovered child via `confidence = 'LAST_KNOWN'`

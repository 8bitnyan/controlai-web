# Tasks: extend-gateway-register-handshake

Depends on `add-plugin-device-type-registry` AND `add-unregistered-device-lifecycle` being applied.

## 1. Prisma: RegistrationProposal model + migration

- [x] 1.1 Edit `packages/db/prisma/schema.prisma` adding `RegistrationProposal` model + `RegistrationProposalState` enum per design §3.2. ~30 LOC delta.
- [x] 1.2 `pnpm --filter @controlai-web/db prisma migrate dev --name add-registration-proposal`. Commit migration.
- [x] 1.3 `prisma generate`.

## 2. Status output parser

- [x] 2.1 Create `apps/web/lib/board-cli/parse-status-output.ts` exporting `parseStatusOutput(raw: string): ParsedBoardStatus` per design §4. Section-by-section regex table; unrecognised lines appended to `_unparsed: string[]`. ~180 LOC.
- [x] 2.2 Create `apps/web/lib/board-cli/parse-discovered-child.ts` exporting `parseDiscoveredChild(raw: string, reportedTypeLabel: string): DiscoveredChild | null`. Validates exactly 24 hex chars; ASCII tail decoded; flags non-printable tails. ~80 LOC.
- [x] 2.3 Create `apps/web/lib/board-cli/__tests__/parse-status-output.spec.ts`:
  - Golden snapshot from the operator's exact pasted output → expected structured result.
  - 3 variants: missing 485-bus section, missing MQTT subs list, extra unrecognised line in [Board Status].
  - Mangled section header → throws.
  - ~140 LOC, ≥ 12 cases.
- [x] 2.4 Create `apps/web/lib/board-cli/__tests__/parse-discovered-child.spec.ts`:
  - `0B0003000F5355533936302D` + `DAEJAK_VM` → `{ address: 11, firmwareTypeCode: '0003000F', serialAscii: 'SUS960-', reportedTypeLabel: 'DAEJAK_VM', raw: ..., portId: 'rs485-1' }`.
  - Wrong length → returns null with reason.
  - Non-printable ASCII tail → `serialAscii: null`.
  - ~80 LOC, ≥ 8 cases.

## 3. Registration matcher

- [x] 3.1 Create `packages/api/src/lib/registration-matcher.ts` exporting `proposeRegistrationMatch(shadows, discovered, lastKnownDecisions?): MatchPlan` per design §5. ~220 LOC.
- [x] 3.2 Create `packages/api/src/lib/__tests__/registration-matcher.spec.ts`:
  - EXACT match by firmwareTypeId.
  - PORT_AND_ADDRESS match.
  - ORDER_FALLBACK match.
  - LABEL_HEURISTIC match.
  - LAST_KNOWN reuse from a prior `RegistrationProposal.userDecisionsJson`.
  - Tie-breaking by lowest createdAt.
  - Unmatched shadows.
  - Extras.
  - Unknown types (firmwareTypeCode with no manifest claim).
  - ~280 LOC, ≥ 20 cases.

## 4. tRPC gateway router extensions

- [x] 4.1 Modify `packages/api/src/routers/gateway.ts` adding 4 procedures `beginRegistration`, `proposeRegistration`, `commitRegistration`, `abortRegistration` per proposal §What Changes. Each is an `orgProcedure` mutation. ~480 LOC delta.
- [x] 4.2 Extend `recordProvisionSuccess`-style audit helpers to emit `gateway.register-*` rows. ~60 LOC.
- [x] 4.3 Wrap `commitRegistration` in `prisma.$transaction` exactly as design §7. Validation: refuse commit when proposal `state !== 'PROPOSED'` or `expiresAt < NOW()`.
- [x] 4.4 Create `packages/api/src/lib/__tests__/gateway-registration.spec.ts`:
  - Begin → propose → commit happy path; assert Device rows updated, audit rows written, RegistrationProposal flipped.
  - Begin → propose → abort: state machine reverses cleanly.
  - Concurrent begin: second call returns the existing PROPOSED row (idempotent within session lifetime).
  - Commit after expiry: rejected.
  - Re-registration: cert revocation called; new cert issued; previousRealUuid captured in audit.
  - Unknown types in proposal → commit blocked.
  - ~400 LOC.

## 5. Auto-expire job

- [x] 5.1 Create `packages/api/src/jobs/registration-proposal-expire.ts`:
  - Every 5 minutes select `state = 'PROPOSED' AND expiresAt < NOW()`.
  - For each, flip the proposal `EXPIRED` and reset the parent gateway + children from `REGISTERING → UNREGISTERED`.
  - Audit row `gateway.register-expired`.
  - ~80 LOC.
- [x] 5.2 Wire into the job scheduler (extension of spec 2's `jobs/index.ts`).

## 6. Web Serial flow client

- [x] 6.1 Create `apps/web/lib/board-cli/register-reducer.ts` per design §What Changes (state machine: IDLE → CONNECTING → READING_STATUS → PROPOSING → AWAITING_USER_DECISION → COMMITTING → DONE | FAILED | ABORTED). ~200 LOC + ~140 LOC tests.
- [x] 6.2 Create `apps/web/app/(app)/orgs/[orgId]/projects/[projectId]/site-groups/[siteGroupId]/gateways/[gatewayId]/register/page.tsx`:
  - Browser-compat gate (reuse from existing spec).
  - Port picker (reuse from existing spec).
  - Step orchestration using the reducer.
  - Calls `beginRegistration` → opens port → sends `status\n` → parses → calls `proposeRegistration` → renders match UI → on confirm calls `commitRegistration`.
  - Raw-console drawer (reuse pattern from existing provision page).
  - `beforeunload` warns "Registration in progress; closing will abandon the session (auto-recovered in 30 min)."
  - ~360 LOC.
- [x] 6.3 Create `apps/web/components/register/register-proposal-table.tsx` (~280 LOC) — the per-sensor checklist.
- [x] 6.4 Create `apps/web/components/register/unmatched-shadows-panel.tsx` (~140 LOC).
- [x] 6.5 Create `apps/web/components/register/extra-children-panel.tsx` (~180 LOC) — includes a manifest picker filtered by category=sensor + parent port acceptsProtocols.
- [x] 6.6 Create `apps/web/components/register/unknown-types-panel.tsx` (~90 LOC).
- [x] 6.7 Create `apps/web/components/register/re-register-banner.tsx` (~80 LOC).
- [x] 6.8 Modify the gateway detail page `app/(app)/.../gateways/[gatewayId]/page.tsx`:
  - Add "Register Device" / "Re-register Board" CTA per proposal "MODIFIED MIDDLE PAGES."
  - Add stuck-session detection: if a `RegistrationProposal` exists in `PROPOSED` state for this gateway, show "Resume registration" banner.
  - ~80 LOC delta.

## 7. Canvas store integration for auto-created extras

- [x] 7.1 Modify `apps/web/stores/canvas-store.ts`:
  - Add `insertAutoCreatedNode(nodeData, position)` that appends an xyflow node + edge from gateway to the new child at the offset `(gateway.x + 200 + idx*40, gateway.y + 100 + idx*40)`.
  - After commit, the page calls the store action to make the canvas reflect the new nodes.
  - ~50 LOC delta.
- [x] 7.2 Test in `apps/web/components/canvas/__tests__/canvas-store.spec.ts`: inserting 3 auto-created nodes via the action produces 3 nodes + 3 edges; positions deterministic.

## 8. Re-registration cert revocation hook

- [x] 8.1 Create `packages/api/src/lib/daemon-cert-revoke.ts`:
  - `revokeCert({ tenantId, fingerprint }): Promise<{ ok: boolean; message?: string }>` calling daemon `DELETE /v1/tenants/{tenantId}/certs/{fingerprint}`.
  - Treats 404 / 501 / 405 as soft-success ("not supported by daemon") and returns `{ ok: true, message: 'daemon does not support revocation; skip' }`. Other errors return `{ ok: false }` with the response body summary.
  - ~80 LOC.
- [x] 8.2 Wire into `commitRegistration` re-register path. On `{ ok: false }`, log warning but still proceed with cert re-issuance (the user explicitly initiated re-register; we don't block on revocation).

## 9. UI tests

- [x] 9.1 Create `apps/web/components/register/__tests__/register-flow.spec.tsx`:
  - Happy path: from drop-in mock adapter → status read → all matches confirmed → commit → page shows success.
  - Unknown-type present → Commit button disabled with tooltip.
  - Bulk-confirm shortcut checks all defaults at once.
  - Extras panel placing a new node calls the canvas-store action.
  - ~360 LOC.
- [x] 9.2 Playwright E2E `tests/e2e/register-flow.spec.ts`:
  - Seeded SiteGroup with one `daejak-main-v1` shadow + two `daejak-vm` shadows.
  - Mock Web Serial adapter scripted to return the operator's exact `status` output.
  - Walk through register flow; assert canvas badges flip Unregistered → Registered with `realUuid` populated.
  - ~280 LOC.

## 10. Documentation

- [x] 10.1 Create `openspec/changes/extend-gateway-register-handshake/research-refs.md` linking to `.slash/workspace/research/identity-rewrite-and-provisioning.md` and noting the DAEJAK CLI output reference.
- [x] 10.2 Update `docs/device-type-authoring.md` (from spec 1) with a section: "Declaring `firmwareTypeIds` to make your manifest discoverable at register-time."
- [x] 10.3 Add `docs/register-flow.md` operator-facing guide. ~120 LOC.

## 11. Validation gate

- [x] 11.1 `pnpm -r typecheck` clean.
- [x] 11.2 `pnpm -r test` clean (≥ 80 new tests across spec).
- [x] 11.3 `openspec validate extend-gateway-register-handshake --strict` clean.
- [x] 11.4 Manual: with a real DAEJAK board + USB cable, run the full register flow end-to-end on the dev environment. Verify canvas badge flips, audit rows present, Devices tab shows `realUuid`.
- [x] 11.5 Manual re-register: physically swap a second DAEJAK board onto the same canvas node; verify previousRealUuid captured in audit and new cert in place.

# Research references — extend-gateway-register-handshake

## Saved research documents

- `.slash/workspace/research/identity-rewrite-and-provisioning.md` — covers AWS IoT JITP, Azure DPS, ThingsBoard `CHECK_PRE_PROVISIONED_DEVICES`. The "shadow → real" identity model in this change is the application of that paper's recommended pattern (stable surrogate `device_key`, alias-table holding `shadowUuid` + `realUuid`).

## Operator-provided reference

The DAEJAK board CLI dump shared in interview round 3 is reproduced verbatim in `design.md §4` and forms the golden snapshot for `parseStatusOutput` tests. That dump is the canonical fixture; future firmware revisions SHOULD add new snapshots alongside it (not replace it).

```
[Board Status]
  Board ID:    2C004A001351353230363438
  ...
[485 Bus Status]
  Registered: 1
  [1] 0B0003000F5355533936302D  type=DAEJAK_VM
```

## Key external references

- Web Serial API spec — `https://wicg.github.io/serial/`.
- ThingsBoard provisioning strategies — `https://thingsboard.io/docs/user-guide/device-provisioning/`. The `CHECK_PRE_PROVISIONED_DEVICES` flow is the conceptual analog.
- step-ca cert revocation API — for daemon revocation hook in re-registration. We treat 404/405/501 as soft-success.

## Internal references

- `openspec/specs/gateway-board-provisioning/spec.md` — the existing capability this change EXTENDS. Existing requirements (cert delivery via Web Serial, audit pattern, CLI command sequence) remain authoritative.
- `openspec/changes/add-plugin-device-type-registry/proposal.md` — provides `firmwareTypeIds` on manifests, consumed by the matcher.
- `openspec/changes/add-unregistered-device-lifecycle/proposal.md` — provides the Device table, `shadowUuid`/`realUuid` alias pair, `REGISTERING` state, and the simulation auto-stop on register.
- `packages/api/src/routers/gateway.ts` (existing) — extended with 4 new procedures in this change.
- `packages/api/src/lib/board-cli-spec.ts` (existing) — shared CLI command vocabulary.
- `apps/web/lib/board-cli/cli-session.ts` (existing) — line-buffered Serial I/O reused as-is.

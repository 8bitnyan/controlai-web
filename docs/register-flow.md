# Gateway register flow operator guide

This guide explains when and how to run **Register Device / Re-register Board** for a gateway.

## When to register

Run registration only after physical board provisioning is complete:

- board is powered and reachable
- RS-485 wiring is final
- broker endpoint + certs are already provisioned
- expected downstream sensors are connected

Registration is the identity rewrite + discovery step. It should not be used as initial provisioning.

## Browser compatibility

The flow uses **Web Serial**.

- Supported: latest Chrome / Edge desktop
- Not supported: Safari / Firefox

If the serial button is unavailable, switch to Chrome or Edge and retry.

## Port selection

1. Open gateway details and start Register Device (or Re-register Board).
2. Click port select and choose the board serial port.
3. Confirm the chosen port belongs to the target board before continuing.

If multiple serial devices are attached, disconnect unrelated devices to avoid wrong-port selection.

## Per-sensor checklist semantics

After status/discovery, each discovered child is shown in a checklist row with confidence:

- **Exact**: strong match; safe to accept as-is.
- **High**: likely correct; verify label/context before commit.
- **Medium**: plausible; manual confirmation recommended.
- **Low**: weak signal; inspect carefully.
- **Unknown**: cannot confidently match; commit is blocked until resolved.

Treat confidence as a review aid, not blind automation. Confirm each row before commit.

## Extras, unmatched, and unknowns

### Extras

Extras are discovered children that do not map to an existing expected canvas node.

- Choose a manifest type
- Optionally auto-create a node/device
- Or leave for manual handling

### Unmatched shadows

Unmatched shadows are expected simulated devices that were not found on the real bus.

Operator actions:

- keep simulated for now
- soft-archive / orphan based on operational policy
- keep as manual placeholder

### Unknown firmware types

Unknowns mean discovered type codes that no manifest claims via `firmwareTypeIds`.

- Commit stays blocked while unknowns exist.
- Add/fix manifest `firmwareTypeIds`, then re-run propose.

## Re-registration story

Use **Re-register Board** when replacing board identity/certs or recovering from identity drift.

Behavior:

1. Existing board cert may be revoked (soft-fail allowed if daemon does not support revoke).
2. New cert is issued and registration commit rewrites identity to the new real UUID mapping.
3. Device registration state is updated back to REGISTERED on success.

If revocation endpoint returns unsupported (404/405/501), flow can proceed with warning.

## Recovery from abandoned sessions

Registration proposals auto-expire after **30 minutes**.

- Expired sessions are cleaned up automatically.
- Devices in temporary REGISTERING state are reset by expire handling.
- You can safely start a new register session after expiry.

If an operator tab is closed mid-session, reopen the gateway page and restart; stale sessions
are expected and recoverable through auto-expire.

# Admin: Unclaimed Factory Boards

**Audience:** Organization administrators (ORG_ADMIN role or higher)  
**Location:** `/admin/unclaimed-boards` route  
**Purpose:** View and track factory-shipped boards before they are claimed by users

## Overview

Factory boards ship from manufacturing with pre-flashed credentials pointing to the shared default daemon's special `factory-qa-unclaimed` tenant. When a board powers on, it immediately connects to the daemon and reports its presence — but it's not yet assigned to any user's canvas or organization.

The **Unclaimed Boards** admin page gives you visibility into all factory boards that have reached the daemon, grouped by last-seen time and signal activity. From here, you can:

- ✅ Verify boards are arriving from the factory floor
- ✅ Check last-seen timestamps (boards are alive)
- ✅ Inspect signal previews (boards are emitting data)
- ✅ Identify boards by UUID for physical correlation
- 🚫 Claim boards (deferred to follow-up `add-board-claim-flow` spec)

---

## Accessing the Page

### In the Dashboard

1. **Log in** to controlai-web as an organization administrator.
2. **Click** → **Admin** (sidebar) → **Unclaimed Boards**.
3. The page displays a filterable table of all boards in the `factory-qa-unclaimed` tenant.

### Required Permissions

- **ORG_ADMIN role or higher** (e.g., OWNER, ADMIN).
- Non-admin users see a 403 Forbidden error.

---

## Reading the Table

The **Unclaimed Boards** table shows:

| Column | Meaning | Example |
| --- | --- | --- |
| **Device UUID** | Unique board identifier (from board firmware) | `a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d` |
| **Last Seen** | Most recent heartbeat/telemetry timestamp | `2 minutes ago` / `2026-05-29 14:35:22 UTC` |
| **Signal Type** | Heuristic guess of the sensor type based on signal pattern | `tilt`, `vibration`, `noise-meter`, `unknown` |
| **Last Value** | Most recent telemetry sample (value + unit) | `45.2 degrees` / `0.95 g` / `72 dB` |

### Example

```
┌─────────────────────────────────────┬──────────────┬────────────┬──────────────┐
│ Device UUID                         │ Last Seen    │ Signal Type│ Last Value   │
├─────────────────────────────────────┼──────────────┼────────────┼──────────────┤
│ a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c │ 30 seconds   │ tilt       │ 42.5°        │
│ f0e1d2c3-b4a5-9687-5432-10fedc9876 │ 2 minutes    │ vibration  │ 0.87 g       │
│ 12345678-abcd-ef01-2345-6789abcdef │ 23 hours     │ unknown    │ (no signal)  │
│ xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx│ Never        │ unknown    │ (offline)    │
└─────────────────────────────────────┴──────────────┴────────────┴──────────────┘
```

---

## Filtering & Sorting

### Sort Options

- **Last Seen (desc)** — Most recent boards first (default)
- **Last Seen (asc)** — Oldest boards first
- **Device UUID** — Alphabetical order
- **Signal Type** — Group by sensor type

### Filter Options

- **Show offline boards** — Toggle to include/exclude boards not seen for >24 hours
- **Signal type** — Filter to specific sensor types (tilt, vibration, noise-meter, etc.)
- **Date range** — Filter by last-seen time (e.g., "last 7 days", "last 24 hours")

---

## Factory Board Lifecycle

### 1. Manufacturing

Factory stamps the board with:
- **Firmware:** Default endpoint = `https://default.daemons.controlai.io`
- **MQTT certificate:** Factory-wide shared mTLS client cert (all boards use the same cert)
- **Default group_id:** `factory-qa-unclaimed`

### 2. Shipment to Site

Board travels from factory → your warehouse/site, still powered off.

### 3. Power On (First Boot)

When you power on a board:
- Firmware connects to `default.daemons.controlai.io`
- Authenticates using the factory MQTT cert
- Joins the `factory-qa-unclaimed` tenant
- Starts emitting sensor data

**Appears on your Unclaimed Boards table** ← You are here

### 4. Claim (Follow-Up Spec)

Once you claim a board:
- Board receives OTA (over-the-air) update with new endpoint + cert + your org's group_id
- Board reboots and connects to your org's sandbox daemon tenant
- You can now add it to your canvas

(This spec will be delivered in follow-up `add-board-claim-flow` spec.)

### 5. On Canvas

After claiming, the board appears as a `REGISTERED` device in your canvas, and you can:
- Apply the canvas to configure it
- See its live signal in the sparklines
- Group it with other sensors

---

## Troubleshooting

### Boards Visible in Unclaimed, But No New Arrivals

**Symptom:** You expected 10 boards from the factory, but only 2 appear in the unclaimed list.

**Diagnosis:**
1. **Check board power:** Are all boards receiving power?
2. **Check network connectivity:** Can boards reach `default.daemons.controlai.io` (TLS on port 443)?
   - If behind a corporate firewall, ensure HTTPS is allowed.
   - If on a restricted network, boards may be blocked.
3. **Check firmware version:** Are all boards flashed with the same firmware version? Different versions may use different endpoints.
4. **Check daemon:** Is the default daemon up? Check `/admin/dashboard` or contact platform team.

**Resolution:**
- Power-cycle board(s) that are missing.
- Verify network access: `curl https://default.daemons.controlai.io/v1/health`
- Wait 2–5 minutes for boards to connect and report.
- Check the page again (refresh browser).

### Board Appears, But Shows "Never" Last Seen

**Symptom:** A board UUID is listed with "Never" as the last-seen time.

**Meaning:** The board connected at some point (UUID registered), but never sent any data.

**Diagnosis:**
1. **Board is offline:** Board may have lost power or network after connecting.
2. **Board is misconfigured:** Firmware may not be emitting (e.g., sensor is not enabled, sampling is paused).

**Resolution:**
- Power-cycle the board and wait for it to report.
- Check board's status LED (if available) to confirm it's powered and network-connected.
- Contact manufacturing if the board is non-functional.

### Board Appears, Then Disappears

**Symptom:** Board was visible in the list 1 hour ago, but now it's gone.

**Meaning:** Board hasn't sent data for >24 hours. The "Show offline boards" toggle controls visibility.

**Diagnosis:**
1. **Board lost power or network.**
2. **Board failed or was disconnected.**

**Resolution:**
- Power-cycle the board.
- Check network connectivity (firewall, DHCP lease, WiFi/ethernet).
- Toggle "Show offline boards" to see if the board is still registered but dormant.

---

## Next Steps

### Prepare for Board Claiming

When the `add-board-claim-flow` spec lands, you'll be able to:

1. Select unclaimed boards from this table.
2. Click "Claim" → specify which organization tenant to assign the board to.
3. Receive confirmation and next-steps for board reboot.

For now, use this page to **verify boards are arriving from the factory** and to **monitor their health**.

### For Platform Team

- Monitor unclaimed board count as a health metric.
- Set alerts if the count exceeds a threshold (e.g., >100 unclaimed boards).
- Check daemon logs if boards stop appearing: `sudo journalctl -u controlai -f` on the default daemon EC2 instance.

---

## See Also

- [Default Daemon Deployment Guide](default-daemon-deployment.md) — Operator guide for the shared sandbox daemon.
- [Instance Provisioning Guide](instance-provisioning.md) — How to provision managed daemons (different from sandbox).
- OpenSpec: [add-board-claim-flow](../openspec/changes/add-board-claim-flow/proposal.md) — Future spec for claiming and OTA board updates.
- OpenSpec: [add-default-daemon-sandbox](../openspec/changes/add-default-daemon-sandbox/proposal.md) — Full technical specification.

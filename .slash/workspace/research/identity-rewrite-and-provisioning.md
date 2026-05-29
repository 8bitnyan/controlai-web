# Research: Shadow → Real Device Identity Rewrite & Gateway Provisioning

**Date:** 2026-05-27

## Summary

This document covers the architectural patterns for a two-phase device identity system where a "shadow" UUID is issued upfront to accept simulated data, then swapped for a "real" device UUID after a gateway-initiated handshake — without losing historical data or breaking dashboards. It analyzes three major IoT cloud provisioning approaches (AWS JITP/Fleet, Azure DPS, ThingsBoard), three time-series ID-rewrite strategies for TimescaleDB, mTLS certificate issuance from Node.js, MQTT topic design that survives UUID swaps, and downstream sensor auto-discovery patterns across LoRaWAN/Zigbee/BLE/Modbus ecosystems.

---

## 1. Vendor Provisioning Approaches

### 1.1 AWS IoT — Just-In-Time Provisioning (JITP) + Fleet Provisioning by Claim

**Handshake flow (JITP):**

1. Device presents an X.509 certificate signed by a registered CA on first MQTT/TLS connection
2. AWS IoT Core sees `PENDING_ACTIVATION` status on the certificate
3. The provisioning template (associated with the CA cert) calls `RegisterThing` — a Lambda-like template that can create IoT Things, attach policies, and set device attributes
4. Certificate transitions to `ACTIVE`; device can now communicate with full permissions
5. Template can extract cert fields: `AWS::IoT::Certificate::CommonName`, `SerialNumber`, `Organization`, etc.

**Fleet Provisioning by Claim (conceptually most reusable for our case):**

- Devices ship with a shared "claim" (bootstrap) certificate
- First connection via claim cert → device requests a **unique production certificate** from AWS IoT Core
- The cloud creates a unique cert and pushes it down over the existing MQTT connection
- Device disconnects, reconnects with the new unique cert
- On reconnect, a separate provisioning template assigns device-specific permissions

```
 ┌──────────┐          ┌──────────────┐          ┌──────────┐
 │  Device  │          │  AWS IoT Core│          │  CA/Certs│
 │(claim crt)│         │              │          │          │
 └────┬─────┘          └──────┬───────┘          └──────────┘
      │  Connect (claim cert) │                        │
      │──────────────────────>│                        │
      │  Request unique cert  │                        │
      │──────────────────────>│                        │
      │                       │   Create device cert   │
      │                       │───────────────────────>│
      │                       │   Return unique cert   │
      │<──────────────────────│                        │
      │  Disconnect           │                        │
      │  Reconnect (unique)   │                        │
      │──────────────────────>│                        │
      │  Full access          │                        │
      │<──────────────────────│                        │
```

**What's reusable conceptually:**
- The **bootstrap → production credential exchange** maps exactly to our shadow-UUID → real-UUID problem, but at the credential layer rather than the application-ID layer
- The provisioning template is a useful pattern: a server-side hook that runs on first real-id registration to backfill data or update dashboards
- Certificate `PENDING_ACTIVATION` → `ACTIVE` is a lifecycle state machine we should mirror in our device registry

**Sources:**
- [AWS JITP docs](https://docs.aws.amazon.com/iot/latest/developerguide/jit-provisioning.html)
- [AWS Fleet Provisioning by Claim sample](https://github.com/aws-samples/automated-iot-fleet-provisioning-by-claim)
- [AWS Device Provisioning overview](https://docs.aws.amazon.com/iot/latest/developerguide/iot-provision.html)

---

### 1.2 Azure IoT Hub — Device Provisioning Service (DPS)

**Handshake flow (X.509 group enrollment):**

1. Device is pre-configured with DPS endpoint + ID Scope
2. Device connects to DPS (port 8883 MQTT or HTTPS) and presents its X.509 leaf cert
3. DPS walks the cert chain up to a registered root or intermediate CA
4. DPS matches against **Enrollment Groups** (shared CA signer) or **Individual Enrollments** (specific leaf cert)
5. The **registration ID** defaults to the Subject Common Name of the device certificate
6. DPS assigns the device to a configured IoT Hub (static or custom allocation policy)
7. DPS creates the device identity in IoT Hub and returns the hub hostname + device ID to the device
8. Device disconnects from DPS and connects directly to IoT Hub

```
 ┌──────────┐          ┌──────────┐          ┌──────────┐
 │  Device  │          │   DPS    │          │ IoT Hub  │
 └────┬─────┘          └────┬─────┘          └────┬─────┘
      │  Connect + X.509   │                     │
      │────────────────────>│                     │
      │                     │ Verify enrollment   │
      │                     │ Assign to Hub       │
      │<─── hub + deviceId ─│                     │
      │  Disconnect         │                     │
      │  Connect direct     │                     │
      │──────────────────────────────────────────>│
      │  Full MQTT comms    │                     │
      │<──────────────────────────────────────────│
```

**Key features relevant to our case:**
- **Enrollment Groups** let us pre-authorize a whole class of devices (e.g., all devices from a manufacturer batch) — analogous to our "site" pre-provisioning
- The `registrationId` → `deviceId` mapping could be repurposed: the gateway announces the real device ID as part of DPS enrollment, and DPS maps it to the IoT Hub identity
- DPS supports **custom allocation policies** via Azure Functions — we could route shadow devices to a staging IoT Hub and real devices to production
- ID Scope provides a namespace isolation boundary, similar to our concept of `site_id` / `group_id`

**Sources:**
- [Azure DPS overview](https://learn.microsoft.com/en-us/azure/iot-dps/about-iot-dps)
- [X.509 attestation concepts](https://docs.azure.cn/en-us/iot-dps/concepts-x509-attestation)
- [DPS terminology (registration ID, device ID, ID scope)](https://learn.microsoft.com/en-us/azure/iot-dps/concepts-service)

---

### 1.3 ThingsBoard Provisioning Strategies

ThingsBoard offers two provisioning strategies per device profile, plus a "claiming" feature:

**Strategy 1 — `CHECK_PRE_PROVISIONED_DEVICES`:**
- Devices must be created in ThingsBoard **before** they first connect
- Provisioning succeeds only if the device exists AND has `provisionState: NOT_PROVISIONED`  
- The server responds with the device's access token or MQTT credentials
- Prevents unauthorized devices from registering

**Strategy 2 — `ALLOW_TO_CREATE_NEW_DEVICES`:**
- ThingsBoard auto-creates the device on first provisioning request
- Useful when unique device identifiers (MAC, serial) are available but you don't know the list upfront
- Device sends a `provisionDeviceKey` + `provisionDeviceSecret` (pre-shared per device profile)

**Claiming (separate from provisioning):**
- A device that already has credentials can send a `v1/devices/me/claim` MQTT message with `{"secretKey":"...", "durationMs":60000}`
- A claiming widget in the UI can then associate the device with a customer account
- Works over the **Gateway MQTT API** too: `v1/gateway/claim` with payload `{"deviceName": {"secretKey": "...", "durationMs": ...}}`

```json
// MQTT Provisioning request
{
  "deviceName": "temp-sensor-01",
  "provisionDeviceKey": "PUT_YOUR_PROVISION_KEY_HERE",
  "provisionDeviceSecret": "PUT_YOUR_PROVISION_SECRET_HERE"
}
```

**Relevance to our case:**
- The `CHECK_PRE_PROVISIONED_DEVICES` + **claiming** pattern is the closest analog: shadow device gets pre-provisioned, gateway handshake later claims it, swapping it to real identity
- The `provisionState` attribute is a good model for our device lifecycle (SHADOW → DISCOVERED → PROVISIONED → ACTIVE)
- The gateway claiming API (`v1/gateway/claim`) shows a workable pattern for a gateway claiming downstream sensors

**Sources:**
- [ThingsBoard Provisioning docs](https://thingsboard.io/docs/user-guide/provisioning/)
- [ThingsBoard MQTT Provisioning API](https://thingsboard.io/docs/reference/mqtt-api/provisioning/)
- [Issue #10261 — CHECK_PRE_PROVISIONED_DEVICES multiple requests](https://github.com/thingsboard/thingsboard/issues/10261)
- [Gateway claiming issue](https://github.com/thingsboard/thingsboard-gateway/issues/1702)

---

## 2. Time-Series DB Identity Rewrite Patterns

These patterns solve the core problem: data was ingested under `shadow-uuid-abc`, but now we need it under `real-uuid-xyz` — and we can't update the partition key of a TimescaleDB hypertable in place.

### Pattern 1: Stable Surrogate Key + Alias Table (RECOMMENDED)

**Approach:**
- The hypertable is partitioned on a **stable surrogate key** (`device_key`) that NEVER changes
- A separate `device_registry` (or alias table) maps `device_key` → `shadow_uuid` / `real_uuid` / current status
- During the shadow phase, the system writes with `device_key = X`, `shadow_uuid = X`, `real_uuid = NULL`
- After the handshake, the alias table is updated: `real_uuid = X`, status = `ACTIVE`
- Historical data is untouched — the partition key never changed
- Dashboards and queries use `device_key` everywhere (joins to alias table for human-readable UUID)

```
device_registry                          hypertable
┌──────────────┬────────────┬──────────┐  ┌──────────────┬──────────┬──────────────┐
│ device_key   │ shadow_uuid│ real_uuid│  │ time         │ device_key│ temperature  │
├──────────────┼────────────┼──────────┤  ├──────────────┼──────────┼──────────────┤
│ dvc_abc123   │ uuid-abc   │ uuid-xyz │  │ 2026-05-01 … │ dvc_abc  │ 22.4         │
│ dvc_def456   │ uuid-def   │ uuid-ghi │  │ 2026-05-02 … │ dvc_abc  │ 23.1         │
└──────────────┴────────────┴──────────┘  │ 2026-05-03 … │ dvc_def  │ 19.8         │
                                          └──────────────┴──────────┴──────────────┘
```

**Pros:**
- Zero data migration required — the swap is a single UPDATE on the alias table
- Partition key unchanged → no chunk reorganization needed
- Compression settings (`segmentby = 'device_key'`) remain valid
- Transactionally consistent: alias update + publish notification can be atomic
- Dashboards never break if they query via `device_key`

**Cons:**
- Every query needs a JOIN to resolve the human-facing UUID (or accept that `device_key` is the primary identifier)
- The `device_key` must be communicated back to the gateway/client during handshake
- Two-column indirection adds cognitive overhead for new developers

**TimescaleDB specifics:**
- `device_key` should be a hash or low-cardinality token (e.g., `dvc_<crc32>`) — not a UUID itself
- Use `segmentby = 'device_key'` for compression; ~100–10,000 unique values per chunk is optimal ([source](https://dev.to/philip_mcclarence_2ef9475/why-your-timescaledb-compression-ratio-is-bad-and-how-to-fix-it-lb1))
- Hypertable PK should be `(device_key, time)` — TimescaleDB supports composite keys that include the time column ([Stack Overflow](https://stackoverflow.com/questions/77451482/are-primary-keys-recommended-on-a-timescale-hypertable))

### Pattern 2: Keep Both IDs + Query-Time Merge

**Approach:**
- The hypertable stores both `shadow_uuid` and `real_uuid` columns
- Shadow-phase writes populate `shadow_uuid` with the placeholder; `real_uuid` is NULL
- After handshake, a background job backfills `real_uuid` on all historical rows
- New writes from that point use `real_uuid` directly
- Dashboards query: `WHERE real_uuid = :target OR (real_uuid IS NULL AND shadow_uuid = :target)`

**Pros:**
- Simple mental model: the data is self-contained in each row
- No JOIN needed for queries

**Cons:**
- Massive UPDATE on hypertable for historical backfill — decompress → UPDATE → recompress cycle on every chunk
- UPDATE on a partition column (if used as partition) is **not allowed** in TimescaleDB
- Wasted storage: every row carries both UUIDs forever
- The query filter `OR` is hard to optimize, especially with chunk pruning
- Compression ratio suffers; `segmentby` can't span two UUID columns efficiently

### Pattern 3: Backfill Copy (INSERT … SELECT + DELETE)

**Approach:**
- Read historical data under `shadow_uuid`, re-INSERT it under `real_uuid` into the hypertable
- Then DELETE the old shadow-UUID rows
- Uses a migration script that runs chunk-by-chunk to avoid IO storms

```
BEGIN;
-- For each chunk:
INSERT INTO hypertable (time, device_key, temperature)
SELECT time, real_uuid, temperature
FROM hypertable WHERE device_key = 'shadow-uuid-abc';

DELETE FROM hypertable WHERE device_key = 'shadow-uuid-abc';
COMMIT;
```

**Pros:**
- No dual-column overhead
- After migration, the hypertable is "clean" — only real UUIDs
- Works with existing dashboards if they already use the real UUID

**Cons:**
- **Temporarily doubles storage** for the data being migrated
- DELETE + INSERT is not atomic for large datasets; there's a window where data exists in both or neither
- Continuous aggregates (materialized views) may double-count during the window
- Chunk decompression/recompression is expensive
- Must be done chunk-by-chunk to avoid overwhelming the DB
- Risky in production: a failed migration mid-way requires careful rollback

### Pattern 4 (Hybrid — our recommendation): Surrogate Key + Space Partition + Alias Table

For TimescaleDB specifically:
- Use **space partitioning** (`add_dimension`) on a hash of `device_key` across 4–8 partitions to enable parallel chunk I/O within a time interval
- The alias table resolves the shadow/real mapping at the application layer
- MQTT topics and ACLs use the `device_key` (never the UUID)
- Continuous aggregates are keyed on `device_key` — they survive the swap transparently

```sql
-- Recommended schema
CREATE TABLE sensor_data (
    time        TIMESTAMPTZ   NOT NULL,
    device_key  TEXT          NOT NULL,  -- stable surrogate, never changes
    shadow_uuid UUID,                     -- nullable, populated during shadow phase
    real_uuid   UUID,                     -- nullable, populated after handshake
    payload     JSONB,
    CONSTRAINT pk_sensor PRIMARY KEY (device_key, time)
);

SELECT create_hypertable('sensor_data', 'time',
    chunk_time_interval => INTERVAL '1 day');

-- Add space partitioning on device_key for parallel I/O
SELECT add_dimension('sensor_data',
    EXISTS (SELECT 1 FROM timescaledb_information.dimensions
            WHERE hypertable_name = 'sensor_data')
    = false  -- only add if not already present
);
-- (pseudocode — actual add_dimension requires empty table or careful migration)

-- Compression: segment on device_key, order by time DESC
ALTER TABLE sensor_data SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'device_key',
    timescaledb.compress_orderby = 'time DESC'
);

-- Alias table
CREATE TABLE device_registry (
    device_key    TEXT PRIMARY KEY,
    shadow_uuid   UUID NOT NULL UNIQUE,
    real_uuid     UUID UNIQUE,
    status        TEXT NOT NULL DEFAULT 'shadow',
    group_id      TEXT,
    created_at    TIMESTAMPTZ DEFAULT now(),
    activated_at  TIMESTAMPTZ
);
```

---

## 3. mTLS Certificate Issuance from Node.js Backend

### Option A: step-ca (Smallstep) — RECOMMENDED for production

- Full ACMEv2 server (`RFC8555`) with REST API
- Run as Docker container or systemd service
- Supports multiple provisioner types: ACME, OIDC, JWK, X5C
- Node.js backend calls step-ca's API or ACME endpoints to issue device certs on demand

```
Architecture:
┌─────────────┐     API call     ┌──────────────┐
│  Node App   │ ───────────────> │   step-ca    │
│ (provision) │                  │ (private CA) │
└─────────────┘                  └──────┬───────┘
                                        │ issues
                                        ▼
                                  ┌──────────┐
                                  │ Device   │
                                  │ X.509    │
                                  │ Cert     │
                                  └──────────┘
```

**Key capabilities:**
- Short-lived certificates (default 24h) — good for IoT where revocation is hard
- ACME challenge types: HTTP-01, DNS-01, TLS-ALPN-01
- Full mTLS support: can issue both server and client certs
- Kubernetes cert-manager integration (step-issuer)
- REST API for certificate management (list, revoke, renew)

**Node.js integration:**
```typescript
// Using step-ca's ACME API via acme-client
import * as acme from 'acme-client';
import { X509Certificate } from 'crypto';

const client = new acme.Client({
  directoryUrl: `https://ca.internal/acme/${provisioner}/directory`,
  accountKey: await acme.forge.createPrivateKey(),
});

const [key, cert] = await client.auto({
  csr: acme.forge.createCsr({
    commonName: deviceId,
    organization: 'ControlAI',
    keySize: 2048,
  }),
});
```

**Setup commands:**
```bash
step ca init --name=ControlAI --dns=ca.controlai.internal --provisioner=acme
step ca provisioner add acme --type ACME
```

**Sources:**
- [step-ca GitHub](https://github.com/smallstep/certificates)
- [step-ca ACME tutorial](https://smallstep.com/blog/private-acme-server/)
- [Configure ACME clients with step-ca](https://smallstep.com/docs/tutorials/acme-protocol-acme-clients)
- [step-ca installation](https://smallstep.com/docs/step-ca/installation)

### Option B: node-forge (pure Node.js, self-contained CA)

Useful for embedded/small deployments where an external CA process is undesirable:

```typescript
import * as forge from 'node-forge';

const caKeys = forge.pki.rsa.generateKeyPair(2048);
const caCert = forge.pki.createCertificate();
caCert.publicKey = caKeys.publicKey;
caCert.serialNumber = '01';
caCert.validity.notBefore = new Date();
caCert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
caCert.setSubject([{ name: 'commonName', value: 'ControlAI Root CA' }]);
caCert.setIssuer([{ name: 'commonName', value: 'ControlAI Root CA' }]);
caCert.sign(caKeys.privateKey, forge.md.sha256.create());

// Issue device cert
const deviceKeys = forge.pki.rsa.generateKeyPair(2048);
const deviceCert = forge.pki.createCertificate();
deviceCert.publicKey = deviceKeys.publicKey;
deviceCert.serialNumber = deviceId;
deviceCert.validity.notBefore = new Date();
deviceCert.validity.notAfter = new Date(Date.now() + 90 * 86400000);
deviceCert.setSubject([{ name: 'commonName', value: deviceId }]);
deviceCert.setIssuer(caCert.subject.attributes);
deviceCert.sign(caKeys.privateKey, forge.md.sha256.create());
```

**Limitations:**
- No automatic renewal (no ACME)
- Key management is your responsibility
- OCSP/CRL requires additional infrastructure
- Good for prototyping; step-ca is production-grade

### Option C: Internal CA via OpenSSL subprocess

Not recommended for Node.js backends — slow, error-prone, and insecure (shell injection surface).

---

## 4. MQTT Topic + ACL Design Surviving a UUID Swap

**Golden Rule: Never use the rewritable UUID in the MQTT topic path.**

### Recommended Topic Structure

Use a stable, immutable `device_key` (the surrogate key from §2) in the topic hierarchy:

```
controlai/{site_id}/{device_key}/{data_type}
```

Concrete examples:
```
controlai/site-berlin-01/dvc_abc123/telemetry/temperature
controlai/site-berlin-01/dvc_abc123/telemetry/humidity
controlai/site-berlin-01/dvc_abc123/status/online
controlai/site-berlin-01/dvc_abc123/commands/calibrate
controlai/site-berlin-01/dvc_abc123/provisioning/handshake_complete
```

**Why this survives the UUID swap:**
| Component | Stable? | Notes |
|-----------|---------|-------|
| `controlai` | ✅ | Fixed prefix |
| `site_id` | ✅ | Assigned at site deployment |
| `device_key` | ✅ | **Never changes** — it's the surrogate from the alias table |
| `data_type` | ✅ | Fixed taxonomy |

The `device_key` stays constant from shadow phase through real phase. Only the mapping in `device_registry` changes.

### ACL Design

MQTT ACLs (e.g., for Mosquitto or EMQX) should be bound to `device_key`:

```
# mosquitto.acl — pattern-based ACL
# Device 'dvc_abc123' can publish telemetry and receive commands
pattern write controlai/site-%u/telemetry/#
pattern read controlai/site-%u/commands/#

# Gateway can publish provisioning events for any device in its site
pattern write controlai/site-berlin-01/+/provisioning/handshake_complete
```

If using EMQX with built-in database or AuthZ:
```sql
-- Authorize device_key to its own topics
INSERT INTO mqtt_acl (username, topic, action, allow)
VALUES ('dvc_abc123', 'controlai/site-berlin-01/dvc_abc123/#', 'all', 1);
```

**Handshake notification topic:**

When the gateway completes a handshake and the alias table is updated, publish an event:
```
controlai/site-berlin-01/dvc_abc123/provisioning/activated
```

Payload:
```json
{
  "device_key": "dvc_abc123",
  "real_uuid": "550e8400-e29b-41d4-a716-446655440000",
  "previous_uuid": "00000000-0000-0000-0000-000000000001",
  "activated_at": "2026-05-27T10:30:00Z"
}
```

**Sources:**
- [AWS whitepaper: Designing MQTT Topics](https://docs.aws.amazon.com/whitepapers/latest/designing-mqtt-topics-aws-iot-core/mqtt-design-best-practices.html)
- [MQTT topic design best practices — Chanh Le](https://chanhle.dev/en/blog/mqtt-iot-messaging-protocol-deep-dive)

---

## 5. Downstream Sensor Auto-Discovery

Gateways sit between the cloud and constrained leaf sensors. Each protocol has its own discovery mechanism; the gateway abstracts these into a uniform event.

### Generic Discovery Pattern

```
1. Sensor powers on / enters network
2. Sensor sends a "hello" / beacon / join-request
3. Gateway detects the new device, reads its unique ID
4. Gateway publishes discovery event to MQTT:
   - topic: controlai/{site_id}/{gateway_device_key}/discovery/{protocol}
   - payload: { child_id, child_type, capabilities, signal_strength }
5. Backend provisions the child device (creates alias table entry)
6. Backend responds with assigned device_key and topic namespace
7. Gateway begins forwarding child data under the device_key
```

### Protocol-Specific Discovery

| Protocol | Discovery Mechanism | Unique Identifier | Notes |
|----------|-------------------|-------------------|-------|
| **LoRaWAN** | OTAA Join-request | DevEUI (8 bytes, IEEE EUI-64) | The Join-request contains AppEUI + DevEUI. The network server must be pre-configured with the AppKey to accept the join. Off-the-shelf sensors ship with unique DevEUI pre-burned. Gateway passively forwards radio packets. |
| **Zigbee** | Network Discovery + IEEE address request | IEEE MAC address (64-bit) | Devices send `Device Announce` when joining. Coordinator/gateway queries `IEEE_addr_request` and `Node_Desc_req`. Application-level clusters (e.g. `Basic Cluster` 0x0000) report manufacturer + model. |
| **BLE** | Advertising packets (scan response) | MAC address or device's advertised UUID | Gateway scans for BLE advertisements. iBeacon/Eddystone/device name in scan response. For connected BLE, the gateway bonds and then reads the Generic Access Service (Device Name, Appearance). |
| **Modbus RTU/TCP** | Polling slave address range (1–247) | Slave ID | Gateway sequentially probes each address with `Read Device Identification` (0x2B/0x0E) or reads a known register. Statically configured slave list is common; auto-discovery is slow and not recommended for large ranges. |

### LoRaWAN Deep Dive (most relevant for battery-powered tailing sensors)

**OTAA Join flow:**
```
End Device          Gateway          Network Server      Join Server
    │                  │                  │                  │
    │  Join-request    │                  │                  │
    │ (AppEUI+DevEUI)  │                  │                  │
    │─────────────────>│   radio fwd      │                  │
    │                  │─────────────────>│ Check MIC        │
    │                  │                  │─────────────────>│ Validate keys
    │                  │                  │<─────────────────│
    │                  │  Join-accept     │  Generate        │
    │                  │ (DevAddr, keys)  │  session keys    │
    │<─────────────────│<─────────────────│                  │
    │  AppSKey+NwkSKey │                  │                  │
    │  from Join-accept │                  │                  │
```

**Discovery integration with our system:**
1. LoRaWAN gateway forwards Join-requests to the network server
2. When join succeeds, the network server emits a `device_activated` event
3. Our backend receives this event, creates a `device_key` record in `device_registry`, and provisions the shadow device
4. The LoRaWAN end-device's EUI becomes its `shadow_uuid`; after the gateway handshake, the `real_uuid` is set

**Sources:**
- [The Things Network: End Device Activation (OTAA)](https://www.thethingsnetwork.org/docs/lorawan/end-device-activation/)
- [The Things Stack: Adding Devices](https://www.thethingsindustries.com/docs/hardware/devices/adding-devices/)
- [LoRaWAN ABP vs OTAA](https://www.thethingsindustries.com/docs/hardware/devices/concepts/abp-vs-otaa/)

---

## 6. Recommended Sequence Diagram

```
┌──────────┐   ┌──────────┐   ┌─────────────┐
│ Device/  │   │ Backend  │   │ Device      │
│ Gateway  │   │ (Node)   │   │ Registry    │
└────┬─────┘   └─────┬─────┘   └──────┬──────┘
     │               │                │
     │  A. SHADOW PHASE               │
     │               │                │
     │  POST /api/v1/provision        │
     │  { site_id }                   │
     │──────────────>│                │
     │               │  INSERT        │
     │               │  device_key,   │
     │               │  shadow_uuid,  │
     │               │  status=SHADOW │
     │               │───────────────>│
     │  201 Created  │                │
     │  { device_key,│                │
     │   shadow_uuid,│                │
     │   topics }    │                │
     │<──────────────│                │
     │               │                │
     │  MQTT connect (device_key)     │
     │  Pub telemetry to              │
     │  controlai/{site}/{key}/tel/#  │
     │══════════════════════════════>│ (hypertable)
     │   (shadow data flows)         │
     │               │                │
     │               │                │
     │  B. HANDSHAKE (gateway discovers real UUID) │
     │               │                │
     │  POST /api/v1/devices/{device_key}/activate │
     │  { real_uuid, cert_csr?,      │
     │    tailing_sensors: [         │
     │      { eui, type, ... }       │
     │    ]                          │
     │  }                            │
     │──────────────>│                │
     │               │                │
     │  ── Optional: mTLS cert ──    │
     │  ┌─── step-ca ACME ─────────┐ │
     │  │ step-ca issues device    │ │
     │  │ cert for real_uuid       │ │
     │  │ (CN=real_uuid)           │ │
     │  └──────────────────────────┘ │
     │               │                │
     │               │  UPDATE         │
     │               │  real_uuid=..., │
     │               │  status=ACTIVE  │
     │               │───────────────>│
     │               │                │
     │               │  ── For tailing sensors: ──
     │               │  INSERT child  │
     │               │  device_keys   │
     │               │  linked to     │
     │               │  parent gateway│
     │               │───────────────>│
     │               │                │
     │  MQTT publish │                │
     │  controlai/.../activated       │
     │<──────────────│                │
     │               │                │
     │  C. REAL PHASE                 │
     │               │                │
     │  MQTT connect (same device_key)│
     │  Pub telemetry (same topics)   │
     │══════════════════════════════>│
     │   (real data flows —           │
     │    dashboards unchanged)       │
     │               │                │
     │  Dashboards:  │                │
     │  SELECT * FROM sensor_data     │
     │  JOIN device_registry          │
     │  WHERE device_key = 'dvc_abc'  │
     │  (shows shadow + real data     │
     │   seamlessly)                  │
```

---

## 7. Entity-Relationship Sketch

```
┌─────────────────────────────┐
│       device_registry       │
├─────────────────────────────┤
│ device_key        TEXT  PK  │ ← surrogate, stable, used in MQTT topics
│ shadow_uuid       UUID  UK  │ ← placeholder from phase A
│ real_uuid         UUID  UK  │ ← from gateway handshake (populated phase B)
│ status            TEXT      │ ← 'shadow' | 'active' | 'retired'
│ site_id           TEXT      │ ← site / deployment location
│ group_id          TEXT      │ ← provisioning group (from gateway handshake)
│ gateway_key       TEXT      │ ← device_key of parent gateway (for tailing sensors)
│ provisioned_at    TIMESTAMPTZ
│ activated_at      TIMESTAMPTZ
│ cert_serial       TEXT      │ ← X.509 serial if mTLS used
│ cert_expires_at   TIMESTAMPTZ
└───────────┬─────────────────┘
            │ 1
            │
            │ *
┌───────────┴─────────────────┐
│     sensor_data (Hypertable) │
├──────────────────────────────┤
│ time              TIMESTAMPTZ  PK
│ device_key        TEXT         PK  ← FK → device_registry.device_key
│ shadow_uuid       UUID              ← denormalized for debugging
│ real_uuid         UUID              ← denormalized after activation
│ metric_name       TEXT
│ value             DOUBLE PRECISION
│ payload           JSONB
└──────────────────────────────┘

┌─────────────────────────────┐
│  device_provision_journal   │ (audit log, not hypertable)
├─────────────────────────────┤
│ event_id          UUID  PK  │
│ device_key        TEXT      │
│ event_type        TEXT      │ ← 'shadow_created', 'activated', 'cert_issued', etc.
│ payload           JSONB     │
│ created_at        TIMESTAMPTZ
└─────────────────────────────┘
```

---

## 8. Key Recommendations

| Concern | Recommendation |
|---------|---------------|
| **Partition key** | Use a stable `device_key` (surrogate) — never the rewritable UUID |
| **ID rewrite** | Alias table approach (Pattern 1) — single UPDATE, zero data migration |
| **MQTT topics** | `controlai/{site_id}/{device_key}/{data_type}` — device_key is the immutable identity |
| **ACLs** | Bind to `device_key` (username or client-id), not the UUID |
| **mTLS certs** | step-ca as private CA with ACME provisioners; Node.js calls the ACME API |
| **Provisioning model** | Three-phase: (A) pre-provision shadow → (B) gateway handshake activates → (C) real data flows under same device_key |
| **Tailing sensor discovery** | Gateway abstracts protocol-specific discovery into MQTT `discovery` events; backend assigns device_keys |
| **Dashboard continuity** | Use `device_key` in dashboard queries; alias table resolves human-readable UUIDs |
| **Grafana/BI integration** | Create a view: `CREATE VIEW device_metrics AS SELECT sd.*, dr.real_uuid, dr.shadow_uuid, dr.site_id FROM sensor_data sd JOIN device_registry dr USING (device_key)` |
| **Compression** | `segmentby = 'device_key'` — ~100–10K unique per chunk for 10–20× compression |

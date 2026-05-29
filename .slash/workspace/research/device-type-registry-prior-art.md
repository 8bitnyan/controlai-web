# Device-Type Registry — Prior Art & Recommendation for ControlAI

**Date:** 2026-05-27  
**Project:** ControlAI (Node.js/TypeScript monorepo: web + api + db + simulator + mqtt-bridge, TimescaleDB)  
**Goal:** Open-ended, plugin-style device-type catalog where each type declares default config (signal rate, signal format) AND connectivity rules (max downstream sensors, allowed parent types, port count, protocol).

---

## Summary

After surveying 6 prior-art systems (ThingsBoard, Home Assistant, Node-RED, AWS IoT, Azure DTDL/Plug-and-Play, KNX, BACnet) and two schema-validation approaches (Zod vs JSON Schema), the recommended path for ControlAI is **an in-repo TS module registry with Zod-validated manifests** — Option A below. DTDL is overkill for early-stage. JSON Schema lacks tight TS integration. The Matter.js `DeviceTypeRegistry` pattern provides a direct template for our stack.

---

## 1. Prior-Art Systems — How Each Models a Device-Type Catalog

### 1.1 ThingsBoard — Device Profiles (CE & PE)

| Aspect | Mechanism |
|--------|-----------|
| **Catalog** | **Device Profiles** — DB-stored entity that groups devices sharing transport, rule-chain, alarm rules, firmware |
| **Config** | Transport type (MQTT/CoAP/LWM2M/SNMP), JSON vs Protobuf payload, topic filters |
| **Relations** | Arbitrary directed relations (`Contains`, `Manages`, etc.) between Device, Asset, and other entities |
| **Validation** | Server-enforced at device provisioning time; no declarative cardinality limits per profile (custom logic needed) |
| **Extensibility** | Admin UI + REST API to add profiles; no "plugin" concept — profiles are runtime DB rows |
| **Source** | [thingsboard.io/docs/user-guide/device-profiles/](https://thingsboard.io/docs/user-guide/device-profiles/) |

**Key insight:** ThingsBoard's Device Profiles map 1:1 to our "device type" concept, but cardinality rules (max downstream sensors, protocol compat) must be custom-coded in rule chains — not declared in the profile.

---

### 1.2 Home Assistant — Integration Manifest & Platforms

| Aspect | Mechanism |
|--------|-----------|
| **Catalog** | **Integrations** — Python packages in `custom_components/<domain>/` with a `manifest.json` |
| **Config** | `manifest.json` declares domain, dependencies, requirements, codeowners, config flow, IoT class |
| **Device hierarchy** | Device → Entities via entity registry; area-based grouping; auto-discovery via DHCP/mDNS/BT/USB |
| **Platforms** | `light.py`, `switch.py`, `sensor.py` etc. — each integration implements standardized device-type abstractions |
| **Validation** | Config flow + schema.yaml for service actions; no hard cardinality limits |
| **Extensibility** | Install via HACS; Python files hot-loaded from filesystem; no compile-time type safety |
| **Source** | [developers.home-assistant.io/docs/creating_integration_manifest/](https://developers.home-assistant.io/docs/creating_integration_manifest/) |

**Key insight:** Home Assistant's manifest-as-directory + platform files is the closest production analog to a plugin system. But it's Python, and there's no built-in mechanism for "this gateway type allows 8 sensor children."

---

### 1.3 Node-RED — npm Node Packages

| Aspect | Mechanism |
|--------|-----------|
| **Catalog** | **npm packages** with `node-red` keyword; registered at runtime via `RED.nodes.registerType()` |
| **Config** | Each node declares its own `.html` (editor UI + defaults) + `.js` (runtime); defaults in JSON |
| **Registry** | Central `RED.nodes` API — `registerType(name, constructor)` where name is unique |
| **Discovery** | npm registry search by `node-red` keyword; FlowFuse private registry option |
| **Validation** | Schema-optional; each node validates its own `config` object; no cross-node relationship validation |
| **Extensibility** | Dynamic — install via palette manager at runtime; restart required to load new types |
| **Source** | [nodered.org/docs/creating-nodes/](https://nodered.org/docs/creating-nodes/) |

**Key insight:** Node-RED's `registerType()` is the canonical JS registry pattern. Our `DeviceTypeRegistry` could follow the same Map-based approach (as Matter.js does below), but with Zod validation baked in.

---

### 1.4 AWS IoT — Thing Types & Device Shadow

| Aspect | Mechanism |
|--------|-----------|
| **Catalog** | **Thing Types** (deprecated but documented) — `ThingTypeName` + `ThingTypeProperties` (searchableAttributes) |
| **Config** | Thing attributes: free-form `Map<String,String>`; Device Shadow: `desired`/`reported` state JSON |
| **Relations** | Thing Groups (hierarchical); no built-in cardinality constraints |
| **Validation** | Backend-enforced for reserved shadow fields; no schema for Thing attributes |
| **Extensibility** | Register Thing Types & Things via API; Shadow represents runtime state |
| **Source** | [docs.aws.amazon.com/iot/latest/developerguide/thing-types.html](https://docs.aws.amazon.com/iot/latest/developerguide/thing-types.html) |

**Key insight:** AWS IoT Thing Types were a lightweight categorization, deprecated in favor of more flexible Thing Groups + attributes. The Device Shadow is a powerful pattern for runtime state (separate from type-definition), which we should adopt for our canvas instances.

---

### 1.5 Azure IoT Plug and Play / DTDL

| Aspect | Mechanism |
|--------|-----------|
| **Catalog** | **DTDL Interfaces** — JSON-LD documents in a Model Repository (device-models.azure.com) |
| **Config** | Properties (read/write), Telemetry (time-series), Commands (RPC), Components (composition), Relationships (edges) |
| **Relationships** | First-class `Relationship` type with `target` Interface, `minMultiplicity`, `maxMultiplicity` |
| **Validation** | DTDL parser validates at model upload; schema enforcement for Property/Telemetry types |
| **Components** | Reusable Interface composition (similar to mixins) |
| **Versioning** | DTMI identifiers (`dtmi:com:example:Thermostat;1`) — semver-like version pinned in `@id` |
| **Source** | [azure.github.io/opendigitaltwins-dtdl/DTDL/v3/DTDL.v3.html](https://azure.github.io/opendigitaltwins-dtdl/DTDL/v3/DTDL.v3.html) |

**Key insight:** DTDL is the *only* system that models relationships with explicit cardinality (`minMultiplicity`, `maxMultiplicity`) — exactly what we need for "this gateway accepts 8 sensors." However, DTDL v3/v4 is JSON-LD with a heavyweight toolchain. For a TS monorepo, the ontology is useful primarily as a *design reference*, not as a runtime dependency.

From the DTDL v3 spec (Relationship section):
```json
{
  "@type": "Relationship",
  "name": "contains",
  "target": "dtmi:com:example:Sensor;1",
  "minMultiplicity": 1,
  "maxMultiplicity": 8
}
```

---

### 1.6 KNX — Datapoint Types (DPT) & Topology

| Aspect | Mechanism |
|--------|-----------|
| **Catalog** | **DPT (Datapoint Types)** — 600+ standardized types (e.g., `DPT_Switch` 1.001, `DPT_Temperature` 9.001) |
| **Config** | DPT defines encoding, range, unit; ETS tool creates Group Addresses mapping DPT to physical |
| **Topology** | Area → Line → Device — couplers enforce segmentation (15 lines/area, 64 devices/line) |
| **Protocol** | TP (twisted pair), IP, RF; couplers filter group telegrams based on filter tables |
| **Validation** | ETS validates at commissioning time; KNX Association maintains DPT registry |
| **Extensibility** | Manufacturers define custom DPTs; KNX Association must approve |
| **Source** | [support.knx.org/hc/en-us/articles/15392604906514-Interworking-Datapoint-types](https://support.knx.org/hc/en-us/articles/15392604906514-Interworking-Datapoint-types) |

**Key insight:** KNX's DPT system is the most mature type-catalog in building automation — 600+ standardized types with precise binary encoding. The topology hierarchy (Area → Line → Device with couplers enforcing limits) directly inspired our proposed `Gateway → Sensor` hierarchy with cardinality enforcement.

---

### 1.7 BACnet — Objects, Properties & BIBBs

| Aspect | Mechanism |
|--------|-----------|
| **Catalog** | **Object Types** (Analog Input, Binary Output, Device, etc.) with standardized Properties |
| **Config** | Each Object has required + optional Properties; PICS (Protocol Implementation Conformance Statement) declares capabilities |
| **Profiles** | **BIBBs (BACnet Interoperability Building Blocks)** — standardized capability sets: B-ASC, B-BC, B-AWS etc. |
| **Services** | 38 services in 5 categories (Data Sharing, Alarm/Event, Scheduling, Trending, Device Management) |
| **Validation** | BTL (BACnet Testing Labs) certifies against PICS; BIBBs define minimum required services |
| **Extensibility** | Vendor-specific Properties allowed; new Object Types via ASHRAE SSPC 135 |
| **Source** | [bacnet.org](https://bacnet.org/wp-content/uploads/sites/4/2022/06/The-Language-of-BACnet-1.pdf) |

**Key insight:** BACnet's BIBBs are the best example of *capability-based device profiles* — "this device is a B-ASC (Application Specific Controller)" implies a specific set of required services. Our device-type manifests could follow a similar "profile prerequisite" model: "this sensor type requires MQTT + JSON + 60s polling interval."

---

## 2. DTDL — Is It a Fit?

**Assessment: Good design reference, not a runtime dependency for our stage.**

| Pro | Con |
|-----|-----|
| First-class `Relationship` with `maxMultiplicity` matches our cardinality needs | JSON-LD toolchain adds complexity vs plain JSON |
| Built-in semantics for Telemetry, Property, Command | No native Zod/TS type inference — validator is a separate CLI |
| Versioning via DTMI identifiers is clean | Azure ecosystem coupling (DTDL v4 is Azure IoT Operations-only) |
| Component composition maps well to Sensor+Gateway | No built-in "hardware limit" concept — you model it as Properties |
| Open spec (W3C JSON-LD/RDF based) | Learning curve for contributors unfamiliar with RDF |

**Bottom line:** Borrow DTDL's *relationship cardinality* concept and *interface composition* pattern, but implement the manifest in plain JSON validated by Zod. Don't take DTDL as a dependency.

---

## 3. Zod vs JSON Schema for the Type-Manifest Contract

| Criterion | Zod v4 | JSON Schema (Draft 2020-12) |
|-----------|--------|-----------------------------|
| **TS type inference** | Native — `z.infer<typeof schema>` | Third-party (`json-schema-to-ts`, `@sinclair/typebox`) |
| **Bundle size** | ~13KB (v4) | 0 (parser) / ~50KB (`@cfworker/json-schema`) |
| **Composition** | `.merge()`, `.pick()`, `.omit()`, `.extend()` | `$defs` + `$ref` — powerful but verbose |
| **Custom validation** | `.refine()`, `.superRefine()` | `if/then/else` or custom keyword (non-portable) |
| **JSON Schema export** | Built-in `z.toJSONSchema()` | N/A — it IS JSON Schema |
| **Error messages** | Structured `ZodError` with path info | Implementation-dependent |
| **Ecosystem** | First-class in tRPC, Hono, Next.js | Universal — OpenAPI, Kubernetes, all languages |
| **Recursive types** | `z.late()` | `$recursiveRef` |

**Recommendation: Zod.** For a TypeScript monorepo, the #1 need is compile-time type safety shared between API validation and frontend forms. Zod provides this with zero extra tooling. JSON Schema is better for cross-language interoperability (e.g., OpenAPI specs), but ControlAI is TS-only.

Zod v4's `z.toJSONSchema()` export means we can generate JSON Schema for cross-service consumers if needed later.

---

## 4. Registry Distribution Patterns

| Pattern | Mechanism | Best For | Tradeoffs |
|---------|-----------|----------|-----------|
| **A. In-repo TS modules** | `src/devices/` directory with `DeviceTypeRegistry.register()` | **Our recommendation** | Tight coupling to repo; type-safe; no version isolation per package |
| **B. npm packages** | Scoped packages (`@controlai/device-xyz`) with `node-red`-style metadata | Third-party plugins | Versioning overhead; CI needed to publish; great for ecosystem |
| **C. DB-stored manifests** | PostgreSQL/JSONB table with Zod-validated schemas loaded at boot | Runtime admin UI changes | No compile-time safety; cache invalidation; harder to version |
| **D. Hot-loaded plugins** | Dynamic `import()` from a plugin directory | Truly dynamic extensibility | Security concerns; error-prone; CJS/ESM complexity |

### Why In-Repo TS Modules (Option A) Wins for Day 1

1. **Type safety at compile time** — Zod schemas are shared across web, api, simulator, mqtt-bridge
2. **Tree-shakeable** — unused device types don't bloat bundles
3. **Testable** — device-type manifests are just TS files in the repo
4. **No infrastructure** — no package registry, no hot-reload concerns
5. **Migration path** — if third-party plugins become needed later, Option A registry becomes the "built-in set" and Option B adds dynamic loading alongside it

The Matter.js project provides the canonical reference: `support/chip-testing/src/devices/DeviceTypeRegistry.ts` ([source](https://github.com/matter-js/matter.js/blob/main/support/chip-testing/src/devices/DeviceTypeRegistry.ts)).

---

## 5. Connection-Capability Modeling

### Core Concepts from Prior Art

| Concept | Source | Our Application |
|---------|--------|-----------------|
| **maxMultiplicity** | DTDL v3 Relationship | Max downstream sensors per gateway |
| **target Interface** | DTDL v3 Relationship | Allowed child device types |
| **BIBB profile prerequisite** | BACnet | "This sensor requires MQTT + JSON" |
| **DPT encoding** | KNX | Signal format declaration |
| **Filter table** | KNX coupler | Protocol/port routing rules |
| **Device profile transport config** | ThingsBoard | Protocol selection + topic mapping |

### Proposed Modeling in One Schema

```typescript
import { z } from "zod";

// -- Primitives --
const ProtocolSchema = z.enum(["mqtt", "zigbee", "modbus-rtu", "opcua"]);
const SignalFormatSchema = z.enum(["json", "protobuf", "raw-binary"]);
const PortSchema = z.object({
  label: z.string(),
  protocol: ProtocolSchema,
  maxConnections: z.number().int().positive(),
});

// -- Device-Type Manifest --
export const DeviceTypeSchema = z.object({
  id: z.string(),
  kind: z.enum(["sensor", "gateway", "controller"]),

  // Default config
  defaultConfig: z.object({
    signalRate: z.string().regex(/^\d+[smh]$/),       // "60s", "5m", "1h"
    signalFormat: SignalFormatSchema,
    protocol: ProtocolSchema,
  }),

  // Connectivity rules
  connectivity: z.object({
    // Allowed parent types for this device (empty = any)
    allowedParentDeviceTypeIds: z.array(z.string()),

    // Physical/virtual ports
    ports: z.array(PortSchema).default([]),          // gateway has N ports
    portCount: z.number().int().positive().optional(), // shorthand

    // Max direct children (for gateways)
    maxChildren: z.number().int().nonnegative().default(0),

    // Allowed child device type IDs
    allowedChildDeviceTypeIds: z.array(z.string()),

    // Protocol compatibility (gateway must speak this)
    protocol: ProtocolSchema,
  }),
});

export type DeviceType = z.infer<typeof DeviceTypeSchema>;
```

### Sketch: Registry Pattern

```typescript
// src/devices/DeviceTypeRegistry.ts
import { DeviceType } from "./schemas";

export interface DeviceTypeEntry {
  manifest: DeviceType;
  // Runtime factory — creates a DB-ready device instance
  createInstance: (config: Record<string, unknown>) => Promise<{
    deviceId: string;
    defaults: Record<string, unknown>;
  }>;
}

const registry = new Map<string, DeviceTypeEntry>();

// Called at module import time by each device-type file
export function registerDeviceType(entry: DeviceTypeEntry): void {
  if (registry.has(entry.manifest.id)) {
    throw new Error(`Device type "${entry.manifest.id}" already registered`);
  }
  registry.set(entry.manifest.id, entry);
}

export function getDeviceType(id: string): DeviceTypeEntry | undefined {
  return registry.get(id);
}

export function listDeviceTypes(): DeviceTypeEntry[] {
  return [...registry.values()];
}
```

### Sketch: A Concrete Device-Type Module

```typescript
// src/devices/gateways/temperature-gateway-v2.ts
import { z } from "zod";
import { registerDeviceType } from "../DeviceTypeRegistry";
import { DeviceTypeSchema } from "../schemas";

const manifest = DeviceTypeSchema.parse({
  id: "temperature-gateway-v2",
  kind: "gateway",
  defaultConfig: {
    signalRate: "60s",
    signalFormat: "json",
    protocol: "mqtt",
  },
  connectivity: {
    allowedParentDeviceTypeIds: [],           // no parents (is a root)
    ports: [
      { label: "sensor-bus", protocol: "mqtt", maxConnections: 8 },
    ],
    maxChildren: 8,
    allowedChildDeviceTypeIds: [
      "temperature-sensor-v1",
      "humidity-sensor-v1",
    ],
    protocol: "mqtt",
  },
});

registerDeviceType({
  manifest,
  createInstance: async (config) => ({
    deviceId: crypto.randomUUID(),
    defaults: {
      ...manifest.defaultConfig,
      ...config,
    },
  }),
});
```

### Canvas-Edit Validation Logic

```typescript
// api/src/services/validateCanvasConnection.ts
function validateConnection(
  parentType: DeviceType,
  childType: DeviceType,
): ValidationResult {
  const errors: string[] = [];

  // 1. Parent must accept this child type
  if (
    parentType.connectivity.allowedChildDeviceTypeIds.length > 0 &&
    !parentType.connectivity.allowedChildDeviceTypeIds.includes(childType.id)
  ) {
    errors.push(
      `Gateway "${parentType.id}" does not allow child type "${childType.id}"`,
    );
  }

  // 2. Child must accept this parent
  if (
    childType.connectivity.allowedParentDeviceTypeIds.length > 0 &&
    !childType.connectivity.allowedParentDeviceTypeIds.includes(parentType.id)
  ) {
    errors.push(
      `Sensor "${childType.id}" does not allow parent type "${parentType.id}"`,
    );
  }

  // 3. Protocol compatibility
  if (parentType.connectivity.protocol !== childType.connectivity.protocol) {
    errors.push(
      `Protocol mismatch: parent "${parentType.connectivity.protocol}" vs child "${childType.connectivity.protocol}"`,
    );
  }

  // 4. Port capacity (count current children + 1 ≤ max)
  //   (requires runtime state lookup — part of instance validation)

  return { ok: errors.length === 0, errors };
}
```

---

## 6. Concrete Recommendations (3 Options Ranked)

### ✅ Option A (RECOMMENDED): In-Repo TS Module Registry

| Aspect | Detail |
|--------|--------|
| **What** | `src/devices/` — each device type is a `.ts` file that calls `registerDeviceType()` at import time |
| **Schema** | Zod v4 — one shared `DeviceTypeSchema` for manifests |
| **Validation** | Zod `.parse()` on import + runtime `.safeParse()` for instances |
| **Persistence** | DB stores *instances* referencing `manifest.id`; manifests are code |
| **Extensible by** | Adding a file to `src/devices/` and importing it |
| **Relationship validation** | Zod + custom validator checks `allowedParentDeviceTypeIds` at canvas-edit time |

**Pros:** Compile-time safety, tree-shakeable, testable, zero infra, direct migration path to plugins later.  
**Cons:** Adding a device type requires a code change + redeploy (acceptable for early-stage monorepo).

---

### Option B: Zod-Schema + DB-Stored Manifests

| Aspect | Detail |
|--------|--------|
| **What** | Device-type manifests stored in TimescaleDB, loaded at boot, validated by shared Zod schema |
| **Schema** | Same Zod `DeviceTypeSchema` — used in both API (validate on write) and app (validate on load) |
| **Validation** | `z.safeParse()` on DB upsert; `z.parse()` on boot load |
| **Persistence** | Manifests are DB rows; API CRUD for device types |

**When to prefer:** If non-developer admins need to add device types via UI without a deploy.  
**Tradeoff:** Lose compile-time safety for custom factory logic; must version migrations; cache-busting complexity.

---

### Option C (NOT RECOMMENDED): Full DTDL Model Repository

| Aspect | Detail |
|--------|--------|
| **What** | DTDL interfaces in a model repo; parse with `@azure/dtdl-parser`; store references in DB |
| **Validation** | DTDL parser validates at model upload; custom Zod layer for app-specific fields |
| **Persistence** | Models in file system or Azure Model Repository; instances in TimescaleDB |

**When to consider:** If future roadmap includes Azure Digital Twins integration or cross-vendor ontology sharing.  
**Tradeoff:** Heavy JSON-LD toolchain for what amounts to Zod-validated JSON; the cardinality/relationship features we need from DTDL are trivially expressible in Zod.

---

## 7. Key References

| Source | Link |
|--------|------|
| ThingsBoard Device Profiles | https://thingsboard.io/docs/user-guide/device-profiles/ |
| Home Assistant Integration Manifest | https://developers.home-assistant.io/docs/creating_integration_manifest/ |
| Node-RED Creating Nodes | https://nodered.org/docs/creating-nodes/ |
| AWS IoT Thing Types | https://docs.aws.amazon.com/iot/latest/developerguide/thing-types.html |
| DTDL v3 Spec (Relationship) | https://azure.github.io/opendigitaltwins-dtdl/DTDL/v3/DTDL.v3.html |
| DTDL GitHub Repo | https://github.com/Azure/opendigitaltwins-dtdl |
| KNX Datapoint Types | https://support.knx.org/hc/en-us/articles/15392604906514-Interworking-Datapoint-types |
| BACnet BIBBs & Profiles | https://7nox.com/bacnet-basics-what-are-device-profiles/ |
| BACnet Language Guide (PDF) | https://bacnet.org/wp-content/uploads/sites/4/2022/06/The-Language-of-BACnet-1.pdf |
| Matter.js DeviceTypeRegistry (code) | https://github.com/matter-js/matter.js/blob/main/support/chip-testing/src/devices/DeviceTypeRegistry.ts |
| Zod v4 JSON Schema | https://zod.dev/json-schema |
| Registry Design Pattern | https://anubhav-gupta62.medium.com/registry-design-pattern-ad4b4c3350e6 |
| HiveMQ — DTDL vs Sparkplug vs OPC UA comparison | https://www.hivemq.com/blog/comparative-analysis-of-data-modeling-standards-for-smart-manufacturing |
| FlowFuse Custom Node Packages | https://flowfuse.com/docs/user/custom-npm-packages |

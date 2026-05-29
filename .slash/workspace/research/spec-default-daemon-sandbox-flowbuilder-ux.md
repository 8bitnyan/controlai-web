# Research: Visual Flow-Builder UX Patterns for IoT Pipeline Configuration

**Date:** 2026-05-29
**Context:** Canvas representing both real devices AND unregistered/simulated nodes; "apply" pushes full reconfigure to a single shared default daemon.

---

## Summary

Seven visual flow-builder platforms were analyzed for their approach to: representing real vs. simulated nodes, deploy/apply semantics, per-node liveness, branch-level testing, and error surfacing. The key architectural insight for our scenario is the **draft/canvas-state dichotomy**: the canvas is *always a staging area*; only explicit "apply" commits state to the daemon. Node-RED's "blue dot" changed-state indicator, n8n's separated validation vs. execution errors, NiFi's per-processor run/stop, and ThingsBoard's "test message" affordance are the most directly applicable patterns.

---

## 1. Node-RED

| Aspect | Pattern | Source |
|--------|---------|--------|
| **Node palette** | Left sidebar palette organized by category (common, function, network, etc.). Drag-to-canvas. Quick-add with `Ctrl+click`. | [Node-RED docs](https://nodered.org/docs/user-guide/editor/workspace/nodes) |
| **Inject node** | Manual trigger button on the node's left edge. Can also auto-trigger at intervals. Single-click fires one message into the flow. | [First flow tutorial](https://nodered.org/docs/tutorials/first-flow) |
| **Debug node** | Sidebar output panel structured by time + source node. Button to enable/disable. 32-char status preview under the node. | [Core nodes docs](https://nodered.org/docs/user-guide/nodes) |
| **MQTT broker nodes** | Config nodes (shared). Green "connected" status text + icon below the node. Red = disconnected. Status updates live. | [Node-RED nodes page](https://nodered.org/docs/user-guide/editor/workspace/nodes) |
| **Simulated / prototype pattern** | Users prototype with Inject (static data) + Function (transforms) before wiring real MQTT-in nodes. No special "simulated" node visual — it's just a different node type in the same canvas. | [Building Simulated IoT System article](https://medium.com/@pranavvijayakumar20/building-a-simulated-iot-system-using-esp32-mqtt-node-red-in-wokwi-175e78da28b3) |
| **Deploy semantics** | Explicit **Deploy** button (top-right). Nodes only exist in editor until deployed. Blue circle above node = undeployed changes. Red triangle = configuration error. | [Creating your first flow](https://nodered.org/docs/tutorials/first-flow) |
| **Node status display** | Status icon + text below node (e.g., "connected", "disconnected"). Classes: `.red-ui-flow-node-error`, `.red-ui-flow-node-changed`. Liveness shown via MQTT/HTTP status indicators. | [flow.scss - Node-RED source](https://github.com/node-red/node-red/blob/254bbe3c/packages/node_modules/%40node-red/editor-client/src/sass/flow.scss#L238-L250) |
| **Disabled nodes** | Toggle in config dialog. Disabled nodes are not created on deploy. If mid-flow, messages stop. Visual: faded appearance. | [Node-RED edit dialog docs](https://nodered.org/docs/user-guide/editor/workspace/nodes) |
| **Config nodes** | Shared reusable configuration (brokers, DB connections). Scope-per-flow or global. Shows count of dependent nodes. | Same as above |

### Key Takeaway
Node-RED's **deploy-as-commit** model is the closest analogue to our "apply to daemon". The **blue dot (changed) / red triangle (error)** badges are a simple, learned pattern. The lack of visual distinction between "real" and "simulated" nodes is a *gap* Node-RED accepts because all nodes are equally real in the runtime.

---

## 2. n8n

| Aspect | Pattern | Source |
|--------|---------|--------|
| **Workflow canvas** | Full drag-and-drop SVG canvas. Nodes color-coded by type. Sidebar editing (not modal dialogs). | [n8n NodeView.vue](https://github.com/n8n-io/n8n/blob/fbccfbc7/packages/frontend/editor-ui/src/app/views/NodeView.vue) |
| **Execution modes** | `manual` (test from UI), `trigger` (automated), `webhook`, `cli`, `error`. Manual mode saves execution data only if configured. | [n8n Execution Modes docs](https://n8n-io-n8n.mintlify.app/workflows/execution-modes) |
| **Per-node errors** | Separated into `issues.execution` vs `issues.validation`. Distinct canvas icons for each. Node-error icon vs. validation-error icon. | [GitHub issue #19029](https://github.com/n8n-io/n8n/issues/19029) |
| **Execution visualization** | Nodes highlight during execution: spinning/green (running), green border+check (completed), red (failed). Animated edges during data flow. | [n8n issue #27961](https://github.com/n8n-io/n8n/issues/27961) — regression bug confirms this UX exists |
| **"Node not reached"** | After execution, if a node was on a path not taken (conditional branch), shows a warning toast: "Node was not executed — execution took a different path." | [PR #27094](https://github.com/n8n-io/n8n/commit/969c32f5a51b33606c0cc407b56f0e68eb0d399c) |
| **Manual trigger** | "Execute Step" button per node. "Run Workflow" button at top. Pin data to test specific scenarios between runs. | [n8n execution modes](https://n8n-io-n8n.mintlify.app/workflows/execution-modes) |
| **Error display** | Input panel never shows error view (always shows last known data). Output panel shows red error banner. Parent-node errors propagate to sub-nodes for input display. | [PR #23116](https://github.com/n8n-io/n8n/commit/e97b6b82ee336e0c5cd10f100cab2fce25104a5e) |
| **Save/Deploy** | Auto-save in background. "Save" button. Workflow must be "Active" to receive triggers/webhooks. Editing is always in a draft state until saved. | Implicit in the UI |

### Key Takeaway
n8n's **separation of validation errors vs. execution errors** is directly applicable. The **pin data** pattern (freeze test data for a node so re-runs are deterministic) is excellent for our "simulate this branch" need. The **warning toast for unreached nodes** is crucial when conditionals route around unregistered hardware.

---

## 3. AWS IoT Greengrass

| Aspect | Pattern | Source |
|--------|---------|--------|
| **Visual configuration** | No freeform canvas. JSON-based deployment definitions. Components are declared in a `components` dictionary with version + configuration. | [AWS Greengrass CreateDeployment API](https://docs.aws.amazon.com/greengrass/v2/APIReference/API_CreateDeployment.html) |
| **Deployment model** | Continuous deployment per target (thing or thing group). New deployment **replaces** previous — one deployment per target. Revisions tracked. | [Create Deployments docs](https://docs.aws.amazon.com/greengrass/v2/developerguide/create-deployments.html) |
| **Component lifecycle** | Deploy → Core device resolves dependencies (BFS) → Downloads → Starts. Components defer deployment via notification hook (e.g., low battery). | [Deploy components docs](https://docs.aws.amazon.com/greengrass/v2/developerguide/manage-deployments.html) |
| **Digital twin / TwinMaker** | Scene composer for 3D models + data binding. Tag entities with time-series data. Rules for visual state change (e.g., temp > 50°C turns mixer red). | [AWS IoT TwinMaker FAQs](https://aws.amazon.com/iot-twinmaker/faqs/) |
| **Simulated devices** | TwinMaker entities can represent simulated cameras. Edge connector for KVS streams video from real OR simulated cameras. No visual "simulated" badge. | [IoT TwinMaker video integration](https://docs.aws.amazon.com/iot-twinmaker/latest/guide/video-integration.html) |
| **Validation** | Component configuration validation happens at deploy time on the core device. `configurationValidationPolicy` sets timeout for validation. | [AWS Greengrass Deployment Policies](https://docs.aws.amazon.com/greengrass/v2/APIReference/API_CreateDeployment.html) |
| **Offline deployments** | Devices receive deployment when they reconnect. Deployments are continuous — new devices in thing group auto-receive latest. | [Deploy components docs](https://docs.aws.amazon.com/greengrass/v2/developerguide/manage-deployments.html) |

### Key Takeaway
Greengrass is less visual but its **replace semantics** (one deployment per target, new completely replaces old) match our "apply = full reconfigure" model. The **TwinMaker scene binding** (3D model + data rules) is a reference for making "simulated" nodes feel tangible.

---

## 4. ThingsBoard Rule Chains

| Aspect | Pattern | Source |
|--------|---------|--------|
| **Rule chain editor** | Drag-and-drop canvas. Nodes connected by named relations (Success, Failure, True, False, etc.). Double-click to configure. | [Rule Engine overview](https://thingsboard.io/docs/paas/eu/user-guide/rule-engine-2-0/overview/) |
| **Test script function** | In-node editor with "Test" button. Users provide sample message payload + metadata, run the TBEL/JS function, see output inline. | [Test script functions section](https://thingsboard.io/docs/paas/eu/user-guide/rule-engine-2-0/overview/) |
| **Create test message** | Send curl to device's REST endpoint with sample telemetry. Monitor node Events tab in debug mode. Not a canvas-level affordance — external. | [Validate incoming telemetry tutorial](https://thingsboard.io/docs/tutorials/validate-incoming-telemetry/) |
| **Apply changes** | Explicit **"Apply changes"** button in bottom-right. Until pressed, chain edits are draft. Imported chains also require Apply. | [Rule chain import docs](https://thingsboard.io/docs/paas/eu/user-guide/rule-engine-2-0/overview/) |
| **Debug mode** | Per-node Events tab shows incoming/outgoing messages + metadata. Requires enabling debug on the node before execution. | [Debug Node Execution docs](https://thingsboard.io/docs/paas/eu/user-guide/rule-engine-2-0/re-getting-started/) |
| **Node status** | Success/Failure/Timeout per message. No visual liveness indicator per node (no "connected" badge like Node-RED MQTT). | [Rule Engine overview](https://thingsboard.io/docs/paas/eu/user-guide/rule-engine-2-0/overview/) |
| **Root vs. sub-chains** | One Root Rule Chain + sub-chains. Rule Chain node forwards messages to sub-chain; Output nodes return control. Enables hierarchical decomposition. | [Rule Chain Node docs](https://thingsboard.io/docs/user-guide/rule-engine-2-0/nodes/flow/rule-chain/) |

### Key Takeaway
The **"Test" button inside script nodes** is a micro-affordance we should replicate. ThingsBoard's **named output relations** (Success/Failure/True/False) make branching visually explicit — useful for conditionals like "if real device connected → route to timescaledb, else → route to simulated logger."

---

## 5. FlowFuse

| Aspect | Pattern | Source |
|--------|---------|--------|
| **Platform model** | Managed Node-RED platform. Adds team collaboration, snapshots, DevOps pipelines, remote device management. | [FlowFuse GitHub](https://github.com/flowforge/flowforge) |
| **DevOps pipelines** | Staged deployment: Development → QA → Production. Each stage push creates a snapshot. Snapshots include flows + env vars + settings. | [FlowFuse DevOps Pipeline docs](https://flowfuse.com/docs/user/devops-pipelines/) |
| **Snapshots** | Point-in-time captures of full instance state. Used as deployment artifacts between pipeline stages. | Same as above |
| **Protected instances** | Read-only editor mode for production. Only pipeline pushes can update. Badge on instance card shows protection status. | Same as above |
| **Load testing** | Blueprint that generates internal message traffic (API/DB/File ops at configurable load levels). Performance monitoring view for CPU. | [FlowFuse load testing blueprint](https://flowfuse.com/blueprints/other/load-testing/) |
| **Test data injection** | Cypress E2E framework uses `deployFixture()` to load a flow JSON + `checkOutput()` to verify node outputs via helper function nodes. | [FlowFuse Dashboard testing](https://dashboard.flowfuse.com/contributing/widgets/testing.html) |

### Key Takeaway
FlowFuse's **snapshot-based deployment** pattern is relevant for our "apply" — the canvas state should serialize to a complete snapshot that the daemon can consume atomically. The **protected instance** pattern (read-only editor in production) prevents accidental canvas edits from affecting live pipelines.

---

## 6. Apache NiFi

| Aspect | Pattern | Source |
|--------|---------|--------|
| **Processor run/stop** | Each processor has individual Start/Stop. Status bar shows aggregate counts (Running, Stopped, Invalid, Disabled). Processors must be valid (no yellow triangle) before they can start. | [NiFi User Guide](https://nifi.apache.org/nifi-docs/user-guide.html) |
| **Run Once** | Right-click → "Run Once" executes a single processor exactly once for testing, regardless of its scheduled state. Only works with Timer/CRON-driven processors. | Same as above |
| **Invalid state** | Yellow triangle = configuration incomplete. Hover to see tooltip with specific issues. Processor cannot start until valid. | [NiFi flow dev intro](https://lestermartin.dev/tutorials/flow-dev-intro/) |
| **Configure vs read-only** | Running processors show "View Configuration" (read-only). Stopped processors show "Configure" (editable). State transitions update dialog mode live. | [PR #9548 — NIFI-13318](https://github.com/apache/nifi/pull/9548) |
| **Relationships** | Named output streams (success, failure, original, unmatched). Auto-terminate relationships without connecting. Connections show queue depth. | [NiFi User Guide](https://nifi.apache.org/nifi-docs/user-guide.html) |
| **Data provenance** | Right-click → "View data provenance" for any processor. Shows FlowFile lifecycle: created, routed, transformed, dropped. | [NiFi Data Provenance docs](https://nifi.apache.org/nifi-docs/user-guide.html) |
| **Canvas status bar** | Persistent bar at bottom: thread count, data size, per-state processor counts, cluster node status. Real-time refresh. | Same as above |
| **Validation on apply** | Parameter Context changes cause: stop affected processors → validate → restart (if previously running). Full validation before apply. | Same as above |

### Key Takeaway
NiFi's **per-processor run/stop** and **invalid state (yellow triangle)** are exactly what we need for each IoT node. The **"Run Once"** affordance maps directly to a "test this branch" action. The **relationships-as-named-outputs** pattern makes the dataflow explicit — every node outputs to named channels (e.g., "success", "timeout", "error").

---

## 7. Common UX Patterns Extracted

| Pattern | Found In | Our Adaptation |
|---------|----------|----------------|
| **Draft/canvas vs. deployed state** | All platforms | Canvas is always staging. "Apply" = full reconfigure to daemon. Show unsaved changes indicator. |
| **Changed-node badge (blue dot)** | Node-RED | Blue badge on nodes with unapplied config changes. |
| **Validation vs. execution errors** | n8n (#19029) | Separate icon for "config is bad" (yellow triangle) vs. "runtime error" (red circle). |
| **Per-node run/stop toggle** | NiFi, n8n | Each IoT node type gets a play/pause button. |
| **"Run Once" / test single node** | NiFi, n8n | Right-click "Simulate this branch" — injects sample data at the selected node. |
| **Inline test button in config** | ThingsBoard | "Test" button inside node config panel with sample I/O preview. |
| **Disabled/faded nodes** | Node-RED, NiFi | Faded opacity for disabled/bypassed nodes. Dashed border for simulated/unregistered. |
| **Status text under node** | Node-RED | Small text line: "connected", "disconnected", "simulated", "error: timeout". |
| **Named output relationships** | ThingsBoard, NiFi | Edges labeled (Success/Failure/Timeout) instead of anonymous wires. |
| **Unreachable node warning** | n8n (#27094) | Toast: "This node was not reached — execution took a different path." |
| **Aggregate status bar** | NiFi | Bottom bar: X running, Y stopped, Z invalid, W simulated. |
| **Pin data for replay** | n8n | Freeze a sample payload on a node so re-triggering the flow uses deterministic input. |
| **Sub-flow / process groups** | Node-RED, NiFi, ThingsBoard | Group related nodes into reusable sub-pipelines. |
| **Auto-layout** | FlowGenX, JieGou, React Flow ecosystem | ELK.js / Dagre for clean automatic arrangement. |
| **Lock canvas / read-only mode** | FlowFuse, NiFi, React Flow patterns | Locked canvas for production view; unlocked for editing. |

---

## 8. Anti-Patterns to Avoid

| Anti-Pattern | Why It's Dangerous | Better Approach |
|-------------|-------------------|-----------------|
| **Invisible apply semantics** | If "apply" happens implicitly (auto-save = live), users don't know when the daemon reconfigures. Could reboot devices mid-operation. | Explicit "Apply to Daemon" button + confirmation dialog + countdown. |
| **Conflating draft with live state** | Node-RED avoids this (blue dot), but tools without a deploy step force users to mentally track what's saved vs. running. | Canvas always shows "unstaged changes" indicator. Separate "last deployed" timestamp. |
| **Hiding which nodes are simulated** | If simulated and real nodes look identical, an operator might "apply" thinking they're deploying to real hardware — only to find data missing. | Distinct visual: **dashed border** + **ghost icon** + **(simulated)** label for unreal nodes. |
| **No per-node validation before apply** | NiFi's yellow triangle pattern prevents starting invalid processors. Without this, users apply broken configs and the daemon fails silently. | Validate every node on change; show red border + tooltip immediately. Block apply if any node is invalid. |
| **Modal-only editing** | Node-RED uses modals for node config. Community feedback: "most painful experience — having to use modal dialogues." | Sidebar editing (n8n style) with live preview is superior for complex configs. |
| **Silent error on missing hardware** | If a real device node is configured but the board isn't available, silent failures erode trust. | Show "device unreachable" status + optional simulated fallback branch. |
| **No undo on canvas** | Complex pipeline edits without undo are frustrating. | Command pattern with undo/redo stack min 50+ actions. Persist draft history. |

---

## 9. Concrete UX Recommendations

For our canvas where each node is one of: `broker`, `ingest`, `timescaledb`, `gateway`, `sensor-board-of-various-types` — some real/flashed, some simulated, and "apply" pushes to a single default daemon.

### R1: Dual Visual State for Every Node

```
┌─────────────────────────────────────────────┐
│  [Status Badge] Node Name         [Run/Stop] │
│  ┌─────────────────────────────────────────┐ │
│  │  Type: sensor-board (v2.1)             │ │
│  │  Status: connected       [real] badge  │ │
│  └─────────────────────────────────────────┘ │
│  [⚡ Input] → [⚡ Output]                     │
└─────────────────────────────────────────────┘
```

- **Real nodes**: Solid border, green dot if connected, red if unreachable.
- **Simulated nodes**: **Dashed border**, ghost/translucent icon, `[simulated]` badge, orange dot.
- **Unregistered nodes**: Dashed border, gray fill, tooltip: "No device mapped — runs in simulation mode."

### R2: Per-Node Status Dashboard

| Element | Visual | Meaning |
|---------|--------|---------|
| Green circle | `●` | Connected to daemon / real device healthy |
| Red circle | `●` | Device unreachable / connection error |
| Orange circle | `●` | Simulated mode (no real hardware) |
| Gray circle | `○` | Disabled node (not part of active pipeline) |
| Blue dot | `◉` | Unapplied changes to this node's config |
| Yellow triangle | `▲` | Configuration invalid — cannot apply |
| Spinner | `⟳` | Currently being provisioned / started |

### R3: Canvas Applies = Full Snapshot Push

```
Canvas State (always draft)
       │
       │  [Apply to Daemon]
       ▼
Snapshot serialized (full JSON: nodes + edges + configs)
       │
       │  POST /api/v1/pipeline
       ▼
Daemon validates → replaces running config → restarts affected
       │
       │  [Daemon reports status]
       ▼
Canvas shows: "Last applied: 2026-05-29 14:32:01 (3s ago)"
              "Status: Running — 4 of 7 nodes active, 2 simulated, 1 error"
```

- "Apply" button shows **diff summary**: "3 nodes changed, 1 new, 0 removed"
- After apply, canvas enters **read-only review mode** for 5 seconds (configurable)
- **Rollback button**: "Revert to previous snapshot" if apply causes errors

### R4: "Simulate This Branch" Affordance

Right-click on any node → "Simulate from here" or a **play button on the edge**:

1. A floating panel opens with sample data input (JSON editor or form)
2. User fills in sample payload + metadata
3. Execution runs through the downstream subgraph only
4. Each downstream node shows its output inline (n8n-style)
5. Simulated execution is visually distinct — **blue dashed animated edges** vs. green for real

### R5: Mixing Real and Simulated in One Canvas

```
[Inject Simulated Temp Data] ──→ [Filter > 40°C] ──→ [Simulated Alert]
         │                              │
         │                              └──→ [TimescaleDB (real)] 
         │
[Real Sensor Board #1] ────────→ [Gateway (real)]
```

- Each node's **status bar at the bottom of the canvas** shows aggregate counts: "4 real, 2 simulated, 1 unregistered"
- Wires from simulated nodes use **dashed lines**; wires from real nodes use **solid lines**
- When a mixed pipeline hits a dead end (simulated node feeding into a real-only sink), show a **yellow "branch incomplete" badge** on the sink node

### R6: Node Type-Specific Liveness

| Node Type | Liveness Indicator |
|-----------|-------------------|
| **Broker** (MQTT) | "connected / disconnected" — green/red dot + active topic count |
| **Ingest** | "X msg/s" — throughput meter + last message timestamp |
| **TimescaleDB** | "connected / error: auth" — DB connection status + row count in last flush |
| **Gateway** | "4 devices connected" — device count + RSSI indicator for each |
| **Sensor Board** | "temp: 23.4°C, humidity: 61%" — latest telemetry preview inside node |

### R7: Draft Diff View

Before applying, show a **sidebar diff panel**:

```
┌─ Changes to Apply ─────────────────────┐
│                                        │
│  + [sensor-board] TempSensor-03        │
│  ~ [broker]   MQTT Broker (changed     │
│  │            port: 1883 → 1884)       │
│  - [ingest]   Legacy Ingest            │
│                                        │
│  Unsafe changes: 0                     │
│  Warnings: 1 (simulated node has no    │
│             real device mapped)        │
│                                        │
│  [Apply]  [Save as Snapshot]  [Cancel] │
└────────────────────────────────────────┘
```

### R8: Canvas Toolbar Layout

```
┌──────────────────────────────────────────────────────────┐
│ [⇄] [🔍] [−  +] [🔒] [Auto-layout]  [Undo] [Redo]      │
│                                            [Simulate]    │
│   Status: 4 of 7 nodes active (2 simulated, 1 err)      │
│   Last applied: 2m ago  —  Draft has 3 changes           │
│                                     [💾 Apply to Daemon] │
├──────────────────────────────────────────────────────────┤
│                                                          │
│                    CANVAS                                 │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  Node Palette  |  Properties Panel  |  Output Log        │
└──────────────────────────────────────────────────────────┘
```

---

## References

| Source | Link |
|--------|------|
| Node-RED editor components | https://deepwiki.com/node-red/node-red/4-editor-components |
| Node-RED styling (flow.scss) | https://github.com/node-red/node-red/blob/254bbe3c/packages/node_modules/%40node-red/editor-client/src/sass/flow.scss |
| Node-RED 5.0 roadmap | https://nodered.org/blog/2025/12/03/node-red-roadmap-to-5 |
| n8n execution modes | https://n8n-io-n8n.mintlify.app/workflows/execution-modes |
| n8n error UX (#19029) | https://github.com/n8n-io/n8n/issues/19029 |
| n8n "node not reached" warning | https://github.com/n8n-io/n8n/commit/969c32f5a51b33606c0cc407b56f0e68eb0d399c |
| AWS IoT Greengrass deployments | https://docs.aws.amazon.com/greengrass/v2/developerguide/create-deployments.html |
| AWS IoT TwinMaker | https://aws.amazon.com/iot-twinmaker/faqs/ |
| ThingsBoard rule engine | https://thingsboard.io/docs/paas/eu/user-guide/rule-engine-2-0/overview/ |
| ThingsBoard test script functions | https://thingsboard.io/docs/paas/eu/user-guide/rule-engine-2-0/overview/ |
| ThingsBoard validate telemetry tutorial | https://thingsboard.io/docs/tutorials/validate-incoming-telemetry/ |
| FlowFuse DevOps pipelines | https://flowfuse.com/docs/user/devops-pipelines/ |
| FlowFuse load testing | https://flowfuse.com/blueprints/other/load-testing/ |
| Apache NiFi user guide | https://nifi.apache.org/nifi-docs/user-guide.html |
| Apache NiFi processor UX (PR #9548) | https://github.com/apache/nifi/pull/9548 |
| React Flow ecosystem patterns | https://automation.visualflow.dev/blogs/building-ai-workflow-builders-with-node-based-uis |
| React Flow builder tutorial | https://dev.to/azimahmed/how-to-start-with-react-flow-and-build-an-advanced-workflow-builder-step-by-step-10oj |

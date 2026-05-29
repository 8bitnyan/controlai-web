# Canvas Library Comparison: Site-Topology Editor

**Date:** 2026-05-27  
**Context:** Building a site-topology editor for IoT/sensor networks — typed nodes (sensors, gateways, broker, ingest, TSDB), validated edges with per-type capacity limits, live data overlays, 100+ node performance target.

---

## Executive Summary

**React Flow (`@xyflow/react` v12) is the clear winner** for this use case. It has the best custom-node ergonomics (nodes are just React components), built-in edge validation via `isValidConnection`, snap-to-grid, multi-select, and a massive ecosystem. The ~100-200 node target is well within its comfort zone; 500+ needs `onlyRenderVisibleElements` and fixed-size nodes. tldraw is the closest alternative with an excellent workflow starter kit but requires a paid commercial license in production. Rete.js is architecturally interesting but over-engineered for a topology editor. React-Diagrams is functionally abandoned.

---

## Detailed Library Analysis

### 1. React Flow (`@xyflow/react`)

| Metric | Value |
|---|---|
| **GitHub** | [xyflow/xyflow](https://github.com/xyflow/xyflow) (monorepo) |
| **Stars** | ~36K (React Flow project) |
| **npm** | `@xyflow/react` — 6.5M weekly downloads |
| **Latest** | v12.10.2 (Mar 27, 2026) |
| **Last commit** | Apr 2, 2026 |
| **License** | MIT |
| **Contributors** | 130 |
| **Dependencies** | 3 (tiny runtime footprint) |

**Custom Node API** — Nodes are plain React components. React Flow injects `id`, `data`, `position`, etc. as props. You register them via a `nodeTypes` map passed to `<ReactFlow>`. The `Handle` component is placed anywhere in the node JSX for connection points. Multiple handles per node are trivial.

**Edge Validation** — Two mechanisms:
1. **`isValidConnection` callback** on `<ReactFlow>` — called for every attempted connection. Return `false` to block it. This is the recommended path for performance ([docs](https://reactflow.dev/api-reference/react-flow)).
2. **Per-handle `isValidConnection`** — passed directly to `<Handle>` for fine-grained control.

Both receive `(connection: Connection) => boolean`, giving you full access to source/target node types and IDs for capacity checks.

**Snap-to-Grid** — Built-in via `snapToGrid={true}` + `snapGrid={[20, 20]}`. No extra code needed.

**Multi-Select** — Built-in: drag a selection rectangle, Ctrl/Shift-click, rubber-band selection. `selectionOnDrag` prop controls behavior.

**Undo/Redo** — Not built into the core (Pro feature in xyflow's paid tier), but trivial to implement with Zustand + zundo middleware or a simple snapshot stack. The community pattern is a `HistoryManager` class that snapshots `{ nodes, edges }` and pushes on meaningful mutations. Reference implementations:
- [MustafaSeyrek/react-flow-undo-redo](https://github.com/MustafaSeyrek/react-flow-undo-redo) (use-undoable)
- Snapshot-based history with 50-item stack (used in production by Auxx AI with 30+ node types)

**Persistence** — Nodes and edges are plain JSON. Serialize via `JSON.stringify({ nodes, edges })`, restore via `setNodes`/`setEdges`. Zero friction.

**Performance at Scale:**
- **100 nodes** — No issues at all. The [stress example](https://reactflow.dev/examples/nodes/stress) shows 450 basic nodes running fine.
- **500 nodes** — Use `onlyRenderVisibleElements={true}` and memoize custom node components. Node dimensions must be static or predefined via `node.width`/`node.height`/`node.handles` so React Flow can cull offscreen elements without mounting them first.
- **1000+ nodes** — DOM-based rendering becomes a bottleneck. The dev team acknowledges this ([issue #3044](https://github.com/xyflow/xyflow/issues/3044)): "React Flow is DOM based and therefore not the best choice for displaying thousands of nodes." Third-party solutions like `@infinit-canvas/react` use OffscreenCanvas + Web Workers for 5000+ nodes at 60fps.
- **Perf improvements in v12**: Selective re-rendering via memoized `NodeRenderer` (PR #3668 made dragging 2-3× cheaper), zustand shallow equality checks.

**Live Data Overlays** — Nodes are React components. You can poll/subscribe to WebSocket data in each node component independently. Custom edges can also render live data. The `useNodesData` and `useHandleConnections` hooks (v12) allow reactive data flow between nodes.

**TypeScript** — First-class. Full TSDoc on all exports. Generic `Node<Data, Type>` types.

**Gotchas:**
- SSR/SSG requires static node dimensions ([docs](https://reactflow.dev/whats-new))
- No built-in undo/redo in community edition — must implement yourself
- `onlyRenderVisibleElements` can cause janky panning when nodes mount/unmount at viewport edges
- The `nodeOrigin` + `snapToGrid` interaction has a known issue ([#5185](https://github.com/xyflow/xyflow/issues/5185))
- Pro examples (helper lines, undo/redo) require a paid subscription

---

### 2. Rete.js

| Metric | Value |
|---|---|
| **GitHub** | [retejs/rete](https://github.com/retejs/rete) |
| **npm** | `rete` — 33.9K weekly; `rete-react-plugin` — 10K weekly |
| **Latest core** | v2.0.6 (Jun 30, 2025) |
| **Latest react-plugin** | v2.1.0 (Aug 29, 2025) |
| **License** | MIT |
| **Dependencies** | Core: 1; React plugin: styled-components, react-area-plugin, etc. |

**Strengths:**
- True framework-agnostic graph engine — the core `NodeEditor` knows nothing about React/Vue/Angular
- Plugin architecture (area, connection-reroute, minimap, context-menu all plugins)
- Built-in LOD (Level of Detail) for large graphs — nodes simplify at zoom levels
- TypeScript throughout
- Has a code-generation pipeline for signal-based processing

**Weaknesses:**
- **Strictly worse DX for this use case.** You need `rete` + `rete-react-plugin` + `rete-area-plugin` + `rete-render-utils` just to render anything on screen
- Requires `styled-components` as a peer dependency (extra bundle weight, potential conflicts)
- React 19 requires explicit `createRoot` passing to the plugin
- The `useRete` hook binds to a ref-based container, so your React components are *inside* a foreign editor, not the other way around
- Node customization is more complex — you subclass `Presets.classic.Node` or replace entire node components via a `customize` callback
- Smaller community, fewer examples, no Pro tier for support
- Last core release was June 2025 (~11 months ago); react-plugin was Aug 2025 (~9 months)
- Weekly downloads (10K) are ~1/650th of React Flow's

**Verdict:** If you were building a visual programming language with code generation (like Node-RED), Rete.js would be worth a look. For a topology editor where you just want custom React nodes on a canvas, it's over-engineered.

---

### 3. React-Diagrams (`@projectstorm/react-diagrams`)

| Metric | Value |
|---|---|
| **GitHub** | [projectstorm/react-diagrams](https://github.com/projectstorm/react-diagrams) |
| **Stars** | 9,400 |
| **Latest release** | v7.0.4 (Feb 15, 2024 — **over 2 years ago**) |
| **Last commit** | Apr 3, 2025 |
| **Open issues** | 321 |
| **License** | MIT |
| **Contributors** | 80 |

**Status: Effectively unmaintained.** No releases in over 2 years. 321 open issues. 7 forks exist trying to keep it alive. The maintainer has moved on. "Docs are currently being worked on" has been the header for years.

**What it does well:**
- Canvas-based rendering (not DOM) — theoretically better at very large graphs
- Object-oriented model layer (NodeModel, PortModel, LinkModel)
- Serialization/deserialization is built-in
- The factory pattern for custom nodes is well-documented

**Why not to use it:**
- No meaningful updates since 2024
- React 18 support was added in 6.7.4 (but no React 19)
- 321 open issues suggests bugs that won't be fixed
- Canvas rendering means no native React composability for live data overlays
- Custom nodes require extending model classes *and* widget classes (heavier than React Flow's component model)
- TypeScript support exists but types are less polished than React Flow

**Verdict:** Don't use it for new projects. The maintenance situation is terminal.

---

### 4. tldraw SDK

| Metric | Value |
|---|---|
| **GitHub** | [tldraw/tldraw](https://github.com/tldraw/tldraw) |
| **Stars** | ~46,900 |
| **Latest release** | v5.0.0 (May 6, 2026 — **days ago**) |
| **Last commit** | May 7, 2026 |
| **License** | **Source-available** (NOT MIT — requires paid license in production) |
| **Contributors** | 220 |
| **Releases** | 115 |
| **npm** | `@tldraw/tldraw` |

**Strengths:**
- Extremely active development — v5.0.0 just landed
- Has an official [**Workflow Starter Kit**](https://tldraw.dev/starter-kits/workflow) (`npm create tldraw@latest -- --template workflow`) that's essentially 80% of what you need: typed nodes with ports, connections via the binding system, a graph execution engine
- Also has an [Image Pipeline Template](https://github.com/tldraw/image-pipeline-template) showing typed ports with validation
- Full infinite canvas, zoom/pan, multi-select, persistence out of the box
- Shape system is extensible via `ShapeUtil` classes — fully typed, well-documented
- Binding system automatically tracks connections when nodes move
- Drag-and-drop API for creating shapes from external palettes
- Massive community (47K GitHub stars, 74K followers, 8.7K Discord)

**Weaknesses for this use case:**
- **Commercial license required in production.** The SDK v4+ license restricts production use. Free 100-day trial, then you must buy a license ([pricing page](https://tldraw.dev/pricing)). Hobby licenses exist but have a watermark.
- **tldraw is a whiteboard SDK first.** You're fighting its abstractions (shapes, tools, bindings) to build a node editor. The workflow starter kit helps, but you're still building *on top of* tldraw's opinionated architecture.
- **Shape !== Node.** In tldraw, everything is a "shape" — your nodes, connections, and ports are all shapes. This is more flexible but also more complex than React Flow's node/edge model.
- **Edge validation requires custom tool state machines.** There's no `isValidConnection` equivalent. You'd need to intercept the binding creation and validate in a custom tool handler.
- **Bundle size.** tldraw is huge compared to React Flow (~1MB+ minified vs React Flow's much smaller footprint).
- **Overkill for a focused topology editor.** You get drawing tools, whiteboard UI, eraser, sticky notes, etc. that you don't need.

**Verdict:** If tldraw were MIT-licensed, it would be a strong contender. The workflow starter kit is impressive. But the commercial license requirement, added complexity, and bundle bloat make it a worse fit than React Flow for a dedicated topology editor.

---

### 5. Flume

| Metric | Value |
|---|---|
| **GitHub** | [chrisjpatty/flume](https://github.com/chrisjpatty/flume) |
| **Stars** | ~2K |
| **Latest release** | v1.2.0 (Nov 5, 2025) |
| **npm** | `flume` — 470 weekly downloads |
| **License** | MIT |

Flume is a lightweight, configuration-driven node editor. You define nodes and ports via `FlumeConfig` (a fluent API). It has a nice DX for simple node editors but lacks the power for your use case:

- No TypeScript types for custom node data
- No edge validation hooks
- No undo/redo
- Tiny community (470 weekly downloads)
- Node rendering is configuration-based, not full React components
- Can't embed complex live data overlays easily
- The repo has open discussions about missing features (circular dependency detection, array ports)

**Verdict:** Good for simple flowchart tools, not suitable for a production topology editor.

---

### 6. Drawflow

| Metric | Value |
|---|---|
| **GitHub** | [jerosoler/drawflow](https://github.com/jerosoler/drawflow) |
| **Stars** | 6,008 |
| **Latest release** | v0.0.60 (Sep 3, 2024 — **1.5+ years ago**) |
| **Last commit** | Oct 19, 2024 |
| **Open issues** | 272 |
| **License** | MIT |

**Verdict: Unmaintained.** Vanilla JS (not React), no TypeScript, no React component model. You'd need to write a React wrapper around it. 272 open issues with no recent activity. Don't use.

---

## Comparison Matrix

| Criterion | React Flow | Rete.js | React-Diagrams | tldraw | Flume | Drawflow |
|---|---|---|---|---|---|---|
| **Custom-node ergonomics** | ★★★★★ | ★★★☆☆ | ★★★☆☆ | ★★★★☆ | ★★☆☆☆ | ★☆☆☆☆ |
| **Edge validation hooks** | ★★★★★ (isValidConnection) | ★★★☆☆ (signal-based) | ★★☆☆☆ (manual) | ★★☆☆☆ (custom tool code) | ★☆☆☆☆ | ★☆☆☆☆ |
| **Snap-to-grid** | ✅ Built-in | ❌ Manual | ✅ Built-in | ✅ Built-in | ❌ | ✅ |
| **Multi-select** | ✅ Built-in | ✅ Plugin | ✅ Built-in | ✅ Built-in | ✅ | ✅ |
| **Undo/redo** | ⚠️ Community impl | ❌ Manual | ❌ Manual | ✅ Built-in | ❌ | ❌ |
| **Persistence (JSON)** | ✅ Trivial | ✅ Built-in | ✅ Built-in | ✅ Built-in | ⚠️ Partial | ✅ |
| **Perf @ 100 nodes** | ✅ Excellent | ✅ Good | ✅ Good | ✅ Good | ✅ Good | ✅ Good |
| **Perf @ 500 nodes** | ⚠️ With `onlyRenderVisible` | ⚠️ With LOD | ✅ Canvas-based | ⚠️ | ❌ | ❌ |
| **Perf @ 1000+ nodes** | ❌ DOM bottleneck | ⚠️ LOD helps | ✅ Canvas | ⚠️ | ❌ | ❌ |
| **Live data overlays** | ✅ React components | ⚠️ Custom nodes | ⚠️ Widgets | ✅ React components | ❌ | ❌ |
| **License** | ✅ MIT | ✅ MIT | ✅ MIT | ⚠️ **Paid** (production) | ✅ MIT | ✅ MIT |
| **Maintenance (2026)** | ✅ Very active | ⚠️ Slow (last ~9mo) | ❌ Dead | ✅ Very active | ⚠️ Slow | ❌ Dead |
| **TypeScript** | ✅ First-class | ✅ Full | ✅ Full | ✅ First-class | ⚠️ Partial | ❌ @types only |
| **Bundle size** | Small (~170KB) | Medium (+styled) | Medium | Large (~1MB+) | Medium | Small |
| **Weekly downloads** | 6.5M | 34K | ~50K | ~200K | 470 | ~30K |
| **Ecosystem** | ★★★★★ | ★★★☆☆ | ★★☆☆☆ | ★★★★☆ | ★☆☆☆☆ | ★★☆☆☆ |

---

## Recommendation: **React Flow (`@xyflow/react`)**

### Why

| Requirement | How React Flow fulfills it |
|---|---|
| Typed nodes with custom React renderers | Nodes are React components. `Node<DataType, "sensor" | "gateway" | ...>` gives full type safety. |
| Edge validation (per-type capacity limits) | `isValidConnection` gets source/target node types + handle IDs. Return `false` if `gateway` already has 8 connected `sensor` nodes. |
| Snap-to-grid | `snapToGrid={true} snapGrid={[20, 20]}` — one line. |
| Multi-select | Built-in rubber-band selection + keyboard modifiers. |
| Undo/redo | Snapshot-based with Zustand/zundo or `use-undoable`. Well-documented community pattern. |
| Persistence as JSON | `nodes` and `edges` are plain JSON. Serialize/deserialize directly. |
| Live data overlays per node | Each node component is independent React — connect to WebSocket, poll, or subscribe per node. Use `useNodesData` for reactive flows. |
| Performance with 100+ nodes | Verified at 450+ nodes in stress test. Use `onlyRenderVisibleElements` + memoized components. |
| MIT license | Free for any use, no commercial restrictions. |
| Maintenance | 6.5M weekly downloads, 130 contributors, releases every few weeks. |

### Gotchas to Watch For

1. **No built-in undo/redo** in the community edition. Plan for a snapshot-based history from day one (see example below).
2. **`onlyRenderVisibleElements` needs fixed-size nodes** for optimal culling. Define `width`, `height`, and `handles` on your node data if using it.
3. **Canvas rendering isn't coming soon.** The team has experimented but deprioritized it ([#5442](https://github.com/xyflow/xyflow/issues/5442)). If you plan beyond 2000 nodes, look at `@infinit-canvas/react` or a hybrid approach.
4. **Pro examples require payment.** The undo/redo and helper-lines examples in the docs are Pro-only. Community implementations exist but aren't officially supported.
5. **`nodeOrigin` + `snapToGrid` bug** ([#5185](https://github.com/xyflow/xyflow/issues/5185)) — absolute vs relative coordinates. Test this with your node sizes.

---

## Minimal Custom-Node TypeScript Sketch (React Flow)

```typescript
import {
  ReactFlow,
  Handle,
  Position,
  type Node,
  type NodeProps,
  type Connection,
  useNodesState,
  useEdgesState,
  addEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// --- Types ---
type NodeType = 'sensor' | 'gateway' | 'broker';
interface TopoNodeData {
  label: string;
  type: NodeType;
  liveValue?: number;
}

type TopoNode = Node<TopoNodeData, NodeType>;

// --- Capacity validation ---
const MAX_SENSORS_PER_GATEWAY = 8;

function isValidConnection(conn: Connection, nodes: TopoNode[]): boolean {
  if (!conn.source || !conn.target) return false;

  const source = nodes.find(n => n.id === conn.source);
  const target = nodes.find(n => n.id === conn.target);
  if (!source || !target) return false;

  // Gateways can only accept up to 8 sensors
  if (
    target.data.type === 'gateway' &&
    source.data.type === 'sensor'
  ) {
    const existingSensorEdges = edges.filter(
      e => e.target === conn.target && e.source !== conn.source
    );
    if (existingSensorEdges.length >= MAX_SENSORS_PER_GATEWAY) return false;
  }
  return true;
}

// --- Custom node component ---
function SensorNode({ data }: NodeProps<TopoNode>) {
  return (
    <div className="node sensor">
      <Handle type="target" position={Position.Left} />
      <div>
        <strong>{data.label}</strong>
        <div className="live-badge">{data.liveValue ?? '—'}</div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

// --- Registration ---
const nodeTypes = { sensor: SensorNode /* , gateway, broker */ };
```

Key points in this sketch:
- `TopoNode` fully types the node's data payload and `type` discriminant
- `isValidConnection` has access to the full node list for cross-node capacity checks
- `Handle` components are placed strategically for input (left) / output (right)
- Each node is an independent React component, making live data overlays trivial
- `nodeTypes` is defined *outside* the component to prevent re-renders

---

## Recommended Stack Summary

```
@xyflow/react       v12.10.2   MIT   Canvas/graph engine
zustand             5.x        MIT   State management (undo/redo via zundo)
use-undoable        5.x        MIT   Or: simple snapshot-based history manager
```

**Implementation order:**
1. Define your node types (`TopoNode = Node<TopoNodeData, NodeType>`) and the `isValidConnection` capacity rules
2. Build custom node components for each type with appropriate Handle placements
3. Wire up snap-to-grid, multi-select, and your snapshot-based undo/redo
4. Add JSON persistence (serialize `{ nodes, edges }` to localStorage or API)
5. Add live data overlays per node via WebSocket/poll subscriptions in each node component

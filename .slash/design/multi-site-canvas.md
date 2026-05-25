# Canvas: Multi-Site Broker Nodes and Apply Flow

## 1. Broker Node: Provisioning State Badge
The `BrokerNode` component must clearly display its binding and provisioning state. It acts as the visual representation of a Site in the architecture.

### State Combinations & Visuals
- **Unbound (New Node)**:
  - Visual: A dashed border or a gray badge stating "Unbound (pending Apply)".
  - Meaning: Node exists only in Canvas state. No Postgres Site row.
- **Bound + Unprovisioned**:
  - Visual: Solid border. Yellow/Amber badge "Provisioning...".
  - Meaning: Has a Postgres Site row (`Site.canvasNodeId` is set), but `controlaiSiteId` is missing or `lastApply` is pending.
- **Bound + Provisioned**:
  - Visual: Solid border (orange-400 as existing). Green badge "Provisioned".
  - Details shown:
    - `ID: {site.controlaiSiteId.slice(0,8)}...` (mono font, text-[9px])
    - `SNI: {site.tlsServername.slice(0,15)}...` (mono font, text-[9px], text-muted-foreground)
- **Bound + Provisioned + Error**:
  - Visual: Red border. Red badge "Apply Failed".

### Interaction
- Clicking the provisioning badge or a new "Site Details" icon on the node opens a `Sheet` or `Dialog` showing the full Site details (or routes to the Sites panel and focuses the row).

### Node Structure (Updated)
```tsx
<div className="relative min-w-[160px] rounded-lg border-2 ...">
  {/* Existing Header: StatusDot, Icon, Label */}
  ...
  {/* Existing Kind/Throughput Badges */}
  ...
  {/* NEW: Provisioning Footer */}
  <div className="mt-2 pt-2 border-t border-border/50 flex flex-col gap-0.5">
    {/* State Badge */}
    <div className="flex items-center justify-between">
      <Badge variant="outline" className="text-[9px] bg-green-50 text-green-700">Provisioned</Badge>
      <button className="text-[9px] text-blue-600 hover:underline">Details</button>
    </div>
    {/* IDs (if provisioned) */}
    <div className="text-[9px] font-mono text-muted-foreground truncate">
      ste_ab12...
    </div>
    <div className="text-[9px] font-mono text-muted-foreground truncate">
      sni: broker1.tnt...
    </div>
  </div>
</div>
```

## 2. Binding Flow
- When a user drags a new Broker node onto the canvas, it starts as **Unbound**.
- The node remains Unbound until the user clicks **Apply**.
- On Apply, the backend `apply-planner` detects unbound brokers and creates new DB Site rows, assigning the `canvasNodeId`.
- The UI then updates the node to **Bound**.

## 3. Apply Preview Affordance
When the user clicks "Apply" on the canvas, the `ApplyPreviewModal` must be explicit about site creation.

### Preview Modal Content
- **Current Status**: "Found N unbound broker nodes."
- **Action**: "Will create N new daemon sites."
- **List**:
  - 🆕 Broker: `label` (Node ID: `node-xyz`) -> Will provision new Site.
  - 🔄 Broker: `label` (Site ID: `ste_abc`) -> Will update existing Site.

The preview uses a compact table or list with shadcn `Badge` elements for "CREATE" (green) and "UPDATE" (blue).

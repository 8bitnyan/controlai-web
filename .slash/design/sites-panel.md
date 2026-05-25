# Sites Panel & Gateway Picker

## 1. Sites Panel (Tab)
To manage multiple sites within a single SiteGroup, we introduce a **"Sites"** tab alongside the existing "Canvas" and "Gateways" tabs in the SiteGroup page.

### Layout
- **Container**: Standard page tab content.
- **Header**: "Sites in this group" + a brief explanation ("Sites represent distinct broker infrastructure instances mapped to your canvas broker nodes.")
- **Table**: Dense tabular data using shadcn `Table`.

### Table Columns
1. **Node / Name**: The label of the broker node, with a small link/icon to "Open in Canvas" (switches to Canvas tab and highlights the node).
2. **Kind**: `mosquitto` | `emqx` | etc.
3. **Daemon IDs**:
   - `controlaiSiteId` (mono, copyable)
   - `controlaiTenantId` (mono, copyable)
4. **SNI / TLS Servername**: `tlsServername` (mono, truncated but copyable).
5. **Bridge Cert**: Badge showing `Present` (green) or `Missing` (yellow).
   - If missing, a quick action button: "Issue Cert" (calls `previewIssueFromDaemon` or similar bridge cert flow).
6. **Apply Status**: `lastApply` state (Success, Failed, Pending).
7. **Actions** (Dropdown menu):
   - "Issue mqtt-bridge cert"
   - "Detach from Canvas Node" (Sets `canvasNodeId` to null, effectively unbinding it).
   - "Delete Site" (Destroys DB row and potentially queues deletion on daemon).

## 2. Gateway Dialog -> Site Picker
Since gateways must now connect to a specific Site rather than just the generic SiteGroup, the `GatewayDialog` needs a target site picker.

### Location
Place the Site picker at the very top of the **Identity** tab, above "Label".

### Design
- **Label**: "Target Site (Broker)"
- **Component**: Native `<select>` or shadcn `Select`.
- **Options**:
  - List all Sites in the SiteGroup.
  - Format: `{Broker Node Label} (Site: {controlaiSiteId.slice(0,8)})`
  - Disabled options: Sites that are not yet provisioned (no `controlaiSiteId`).
- **Validation**: Required field. A gateway must be bound to a specific site.

### Impact on "Detect from project"
The "Detect from project" button in the Advanced SNI routing section will now use the selected Site's `brokerHost`, `brokerPort`, and `tlsServername` rather than assuming a single site for the whole group.

```tsx
<div className="space-y-1 mb-4">
  <Label htmlFor="gw-target-site">Target Site (Broker)</Label>
  <select
    id="gw-target-site"
    value={selectedSiteId}
    onChange={(e) => setSelectedSiteId(e.target.value)}
    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
    disabled={!!existing || sites.length === 0}
  >
    <option value="" disabled>Select a provisioned site...</option>
    {sites.map(site => (
      <option key={site.id} value={site.id} disabled={!site.controlaiSiteId}>
        {site.brokerNodeLabel || 'Unknown Node'} ({site.controlaiSiteId?.slice(0,8) ?? 'Unprovisioned'})
      </option>
    ))}
  </select>
  {sites.length === 0 && (
    <p className="text-xs text-destructive mt-1">No sites provisioned yet. Apply your canvas first.</p>
  )}
</div>
```

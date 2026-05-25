# Design System: controlai-web

## Generated Recommendations
- Palette: High-contrast technical interface (white/orange for broker nodes, muted grays for metadata)
- Typography: Dense tabular data (Inter/sans for UI, mono for IDs and certs)
- Style: shadcn/ui components (badges, tabs, tables, dialogs, sheets)
- Anti-patterns: Avoid huge paddings. Avoid hiding critical system state behind hovers.

## Craft Decisions
- Direction: Data-dense control plane. The user needs to see the exact state of infrastructure mapping (Canvas Node -> Postgres DB -> Daemon) without clicking.
- Signature: The "binding status" badge. A clear visual indicator showing the tripartite state (Unbound -> DB Bound -> Daemon Provisioned).
- Depth: Borders and subtle background tints (e.g. bg-muted/30) rather than heavy shadows.
- Spacing: Compact spacing (gap-1, px-2 py-1) for inner-node details to keep the canvas clean but informative.
- Typography: Use mono text for `controlaiSiteId` and `tlsServername` since these are technical identifiers.

## Multi-Site Architecture
The platform is transitioning from a 1:1 SiteGroup-to-Site model to a 1:N model. A single canvas (SiteGroup) can contain multiple Broker nodes, each mapping to a distinct Site row, which in turn maps to a daemon-provisioned site.

To support this, the interface must explicitly visualize the mapping between Canvas Nodes, DB Sites, and Daemon status.

For page-specific deviations and feature designs, see:
- [Canvas Broker Node](./multi-site-canvas.md)
- [Sites Panel](./sites-panel.md)

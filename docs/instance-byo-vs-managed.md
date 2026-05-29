# Instance BYO vs Managed: Choosing Your Daemon Model

ControlAI supports two ways to attach a daemon to your organization:

1. **BYO (Bring Your Own)** — You run and manage the daemon on your own infrastructure.
2. **Managed** — ControlAI provisions and manages the daemon for you.

This guide helps you understand the differences and choose which model fits your needs.

## Quick Comparison

| Aspect | Sandbox (Default) | BYO (Register) | Managed (Provision) |
| --- | --- | --- | --- |
| **Who starts the daemon** | ControlAI (pre-deployed) | You (manual setup) | ControlAI (one click) |
| **Infrastructure owner** | ControlAI (shared EC2) | You | ControlAI (via AWS ECS-on-EC2) |
| **Daemon bearer token** | Fixed per org at signup | You generate and manage | Auto-generated, encrypted at rest, never shown in plain text |
| **Token display** | Encrypted in DB; never shown | You paste into form during setup | Never displayed; stored encrypted |
| **URL format** | Fixed: `https://default.daemons.controlai.io` | Any HTTPS URL you provide | Auto-derived: `https://<orgSlug>-<env>.daemons.controlai.io` |
| **URL control** | None; immutable shared URL | You own the domain | Immutable ControlAI domain |
| **Multitenancy** | Shared tenant per org + factory-qa-unclaimed | Separate daemon per org | Separate daemon per org |
| **Synthetic signals** | ✅ Yes (5 generators: tilt, vibration, noise-meter, etc.) | ❌ No | ❌ No |
| **Setup time** | Instant (automatic at signup) | Manual (30 min–2 hours) | 1–2 clicks, 30–60 seconds |
| **Cost** | Free (operator-maintained) | Your infra cost | Managed-tier subscription |
| **SLA & Uptime** | Best-effort; no SLA | Your responsibility | Managed by ControlAI |
| **Uniqueness** | One shared daemon per org | Multiple daemons per org OK | One daemon per `(org, env)` pair only |
| **Reset semantics** | Per-org tenant only (wipe & reapply canvas) | Per-daemon (you manage reset) | Per-daemon (you manage reset) |
| **Audience** | All orgs; testing & prototyping | On-prem, air-gapped, custom infra | Managed-tier customers, fast onboarding, cloud-native |

## Detailed Comparison

### Sandbox (Default Daemon)

**What is it?** Every organization automatically gets a singleton instance pointing to a shared, pre-deployed EC2 daemon at `default.daemons.controlai.io`. No setup or provisioning needed — it's ready to use immediately at signup.

**Best for:** 
- ✅ Testing and prototyping the full pipeline (broker → ingest → TSDB → dashboard) before hardware arrives.
- ✅ Learning ControlAI with synthetic signal generators (no real hardware needed).
- ✅ Sandbox use cases where data loss is acceptable and SLA is not required.
- ✅ Factory QA workflow (boards land in `factory-qa-unclaimed` for visibility).

**Key Features:**
- **Instant:** No provisioning; ready at signup.
- **Synthetic signals:** 5 built-in generators (tilt, vibration, crack-encoder, noise-meter, vibrating-wire) for testing without hardware.
- **Per-org tenant isolation:** Your canvas only affects your org's tenant slice; other orgs unaffected.
- **Reset semantics:** Apply wipes and reconfigures only your tenant (no manual teardown).
- **Mixed real + synthetic:** Drag real factory boards + synthetic nodes onto the same canvas.

**Limitations:**
- **Shared infrastructure:** No per-org SLA; subject to maintenance.
- **Fixed URL:** Cannot customize domain.
- **Limited retention:** 7–30 days TSDB retention (configurable but no advanced tuning).
- **Single region:** No failover; if daemon goes down, sandbox is unavailable.

**Next Steps:** When you're ready for production, graduate to **Managed (Provision)** for dedicated infrastructure and SLA.

---

### Setup Complexity

**BYO:** You must:
1. Stand up a daemon container on your infrastructure (VM, Kubernetes, Docker, etc.).
2. Generate a bearer token (either manually or via your daemon).
3. Expose the daemon on an HTTPS URL accessible to ControlAI.
4. Paste the URL and token into the ControlAI dashboard.

**Managed:** You:
1. Click "Provision Instance".
2. Choose an environment (`prod`, `staging`, or `dev`).
3. Click "Create".
4. Wait 30–60 seconds for provisioning to complete.
5. Start using the daemon in your projects.

### Security & Token Handling

**BYO:**
- You generate and manage the bearer token yourself.
- The token is your responsibility to rotate, revoke, and secure.
- You paste it into the dashboard (token is visible briefly during form entry).
- If the token leaks, you must re-generate it and reconfigure all projects.

**Managed:**
- ControlAI generates a cryptographically secure bearer token automatically.
- The token is encrypted at rest in the database — ControlAI operators cannot view it in plain text.
- The token is never displayed in the UI; you cannot copy it (it's only used internally by the dashboard to communicate with your daemon).
- If the token is ever compromised, deprovision and re-provision the daemon to get a new one.

### URL & Domain

**BYO:**
- You own the domain and URL format (e.g., `https://my-daemon.mycompany.com` or `https://10.0.1.5:8443`).
- You are responsible for DNS, TLS certificates, and ingress routing.
- URL is changeable (you can update it in the dashboard at any time).

**Managed:**
- URL is automatically derived from your organization slug and environment: `https://<orgSlug>-<env>.daemons.controlai.io`.
- You don't need to own a domain or manage TLS for the daemon (ControlAI handles it).
- The organization slug must match the regex `/^[a-z][a-z0-9-]{1,63}$/` (lowercase alphanumeric and hyphens, starting with a letter, max 63 chars).
- The organization slug is **immutable** once set — renaming the org later does not change the slug.
- URL cannot be customized (it's derived from the slug and environment).

### Multiple Daemons per Organization

**BYO:**
- You can register **multiple** daemons per organization.
- Useful if you want one daemon per region, environment, or workload.
- Each daemon has its own URL and bearer token.

**Managed:**
- You can provision up to **three** daemons per organization (one per environment: `prod`, `staging`, `dev`).
- Attempting to provision a second daemon for the same environment returns a conflict error.
- This limit prevents accidental duplicate provisioning and reduces your bill.

### Stuck Provisioning & Retries

**BYO:**
- If daemon registration fails (bad URL, no connectivity, etc.), you delete the failed row and re-try registration.
- No automatic retry mechanism.

**Managed:**
- If provisioning fails or gets stuck, click "Retry Provision" in the UI.
- The system re-invokes provisioning from scratch.
- If provisioning is stuck for >10 minutes, a UI flag prompts you to retry.
- Failed rows are auto-deleted after 24 hours (you don't need to manually clean them up).

### Teardown & Cleanup

**BYO:**
- To remove a daemon, click `instance.delete()` in the UI.
- You are responsible for actually tearing down the daemon on your infrastructure.
- ControlAI just removes the row from the database.

**Managed:**
- To remove a daemon, click `instance.deprovision()` in the UI.
- ControlAI automatically tears down the ECS container, deregisters the Cloud Map service, and removes the row.
- You cannot deprovision if projects are still attached; delete projects first.
- Failed provisions are auto-deleted after 24 hours without manual intervention.

## When to Choose Sandbox (Default Daemon)

Choose **Sandbox** if:

- ✅ You're **new to ControlAI** and want to test the pipeline without any provisioning.
- ✅ You want **synthetic signal generators** to test without real hardware.
- ✅ You're in **early prototyping** and expect high iteration (reset is simple).
- ✅ You're **shipping factory boards** and want to see them land in `/admin/unclaimed-boards`.
- ✅ You want to **mix real + synthetic nodes** on one canvas.
- ✅ You **don't need an SLA** (sandbox mode assumes data-loss is acceptable).

**Important:** This is the default tier. All organizations get it automatically. You cannot disable or opt out of the default daemon.

---

## When to Choose BYO

Choose **BYO (Bring Your Own)** if:

- ✅ You **must run the daemon on your own infrastructure** (on-prem, air-gapped, corporate firewall, custom network).
- ✅ You need **custom domain names** for your daemons (e.g., `daemon.yourcompany.com`).
- ✅ You want **full control** over daemon versions, patches, and configuration.
- ✅ You prefer **multiple daemons per organization** (e.g., one per region).
- ✅ You have **existing daemon infrastructure** and want to integrate it with ControlAI.
- ✅ You want to manage **bearer token lifecycle** yourself.

## When to Choose Managed (Provision)

Choose **Managed (Provision)** if:

- ✅ You've **tested your pipeline in the sandbox** and are ready for production.
- ✅ You want **dedicated infrastructure per organization** (not shared).
- ✅ You want **zero-touch daemon deployment** — one click and you're done.
- ✅ You prefer **ControlAI to manage infrastructure** for you.
- ✅ You're OK with **ControlAI's domain** (`*.daemons.controlai.io`).
- ✅ You want **automatic token encryption** and management.
- ✅ You want **one daemon per environment** (prod, staging, dev).
- ✅ You want **automatic cleanup** of failed provisions.
- ✅ You're a **managed-tier customer** and want a turnkey solution.
- ✅ You want **SLA and uptime guarantees** (managed tier includes this).

## Migration Between Models

### From BYO to Managed

You **cannot** automatically migrate a BYO daemon to Managed. However:

1. **Keep the BYO daemon running** (for backward compatibility with any projects).
2. **Provision a new Managed daemon** using `instance.provision()`.
3. **Attach new projects** to the Managed daemon.
4. **Gradually migrate existing projects** from the BYO daemon to the Managed daemon (one at a time, testing as you go).
5. Once all projects are migrated, **deprovision** the BYO daemon using `instance.delete()`.

### From Managed to BYO

If you later want to switch a Managed daemon to BYO:

1. Note down the `baseURL` of the Managed daemon (e.g., `https://acme-prod.daemons.controlai.io`).
2. **Deprovision** the Managed daemon — this tears down the ControlAI-managed container.
3. Stand up your own daemon on your infrastructure (to the same URL or a different one).
4. **Register the BYO daemon** using `instance.register()` with your new URL.
5. **Migrate projects** from the old Managed daemon to your new BYO daemon.

## Technical Details

### BYO Rows in the Database

BYO instances are stored in the `ControlaiInstance` table with:
- `env IS NULL` (no environment enum)
- `provisionerInstanceId IS NULL` (no provisioner backend)
- `provisioningStartedAt IS NULL` (immediate HEALTHY state)

### Managed Rows in the Database

Managed instances are stored in the `ControlaiInstance` table with:
- `env IN ('prod', 'staging', 'dev')` (required)
- `provisioningStartedAt` set to the provision start time
- `provisionerInstanceId` set by the provisioner (e.g., ECS task ARN for EC2 backend)
- Initial `status='PROVISIONING'`, then `'HEALTHY'` or `'PROVISION_FAILED'`

### Collision Protection

A **partial unique index** enforces one Managed daemon per `(org, env)` pair:

```sql
CREATE UNIQUE INDEX "ControlaiInstance_orgId_env_unique"
  ON "ControlaiInstance" ("orgId", "env")
  WHERE "env" IS NOT NULL;
```

BYO rows (where `env IS NULL`) are exempt from this index and can coexist with Managed rows of any environment.

## FAQ

**Q: Do I have to use the Sandbox (default daemon)?**

A: The default daemon is automatically created for every organization at signup. You cannot disable it, but you can ignore it and provision a Managed or BYO daemon instead. All three tiers can coexist in the same organization (though most users stick with one).

**Q: Can I use Sandbox for production?**

A: Not recommended. The sandbox daemon is shared, has no SLA, and data loss is acceptable by design. For production use, graduate to **Managed (Provision)** for dedicated infrastructure and uptime guarantees.

**Q: Can I have both a BYO and Managed daemon in the same org?**

A: Yes. BYO rows are exempt from the collision check, so you can run a BYO daemon alongside one Managed daemon per environment. This is useful during migration.

**Q: Can I change my organization slug after creation?**

A: No. The organization slug is immutable. The managed daemon URL depends on it, so changing it would break existing daemons. If you need a different slug, you must create a new organization.

**Q: What if I provision a Managed daemon and then my app crashes?**

A: The daemon row stays in the database in `PROVISIONING` state. Once your app restarts, you can click "Retry Provision" to continue. If it stays stuck for >10 minutes, the UI will flag it and prompt you to retry.

**Q: Can I use a custom domain for a Managed daemon?**

A: Not in v1. The URL is always derived from your slug and environment. A future update may allow custom domain routing, but the underlying daemon will still run on ControlAI infrastructure.

**Q: What happens if I deprovision a Managed daemon while projects are attached?**

A: The system will reject the deprovision request and list the attached projects. Delete those projects first, then deprovision.

## See Also

- [Default Daemon Deployment Guide](default-daemon-deployment.md) — Operator guide for the shared sandbox daemon.
- [Instance Provisioning Guide](instance-provisioning.md) — Detailed instructions for provisioning Managed daemons.
- [BYO Registration](register-flow.md) — How to register a BYO daemon.
- [Admin: Unclaimed Boards](admin-unclaimed-boards.md) — How to view factory boards in the sandbox.
- OpenSpec: [add-instance-auto-provisioning](../openspec/changes/add-instance-auto-provisioning/proposal.md) — Full technical specification for Managed provisioning.
- OpenSpec: [add-default-daemon-sandbox](../openspec/changes/add-default-daemon-sandbox/proposal.md) — Full technical specification for the default daemon.

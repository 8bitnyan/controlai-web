# Research: Daemon Hosting Cost Comparison Across Managed Providers

**Date**: 2026-05-28  
**Scope**: Single small long-running HTTPS daemon (~256 MB RAM, ~0.25 vCPU, persistent process, occasional MQTT/HTTP outbound) — one per customer organization.  
**Assumption**: Wildcard domain `*.daemons.controlai.io` routes to each daemon via application-level routing (path or subdomain-based), so a single wildcard TLS cert suffices for all.

---

## Summary Table

| Provider | Per-Daemon $/mo (1–10 customers) | Per-Daemon $/mo (100 customers) | API Ergonomics | Wildcard TLS | Cold-Start | Key Gotchas |
|---|---|---|---|---|---|---|
| **Fly.io** | **$2.02–2.10** (shared-cpu-1x@256MB) | **$2.02–2.10** (linear) | ✅ Full REST API (`api.machines.dev`), OpenAPI spec, rich SDK | ✅ $1/mo wildcard cert via Let's Encrypt; first 10 single-hostname certs free | ~300ms | No free tier for new signups; egress $0.02/GB NA/EU, up to $0.12/GB India/Africa; stopped machines still cost $0.15/GB/mo rootfs |
| **Railway** | **$7.57** (0.25 vCPU + 256MB @ per-second billing, Hobby plan) | **$7.57** (linear, but Hobby capped at 50 projects × 50 services = 2500 total) | ⚠️ GraphQL only (not REST); API endpoint `backboard.railway.com/graphql/v2` | ✅ Automatic Let's Encrypt; wildcard supported | ~1–3s (App Sleeping) or 0 if disabled | Egress $0.05/GB adds up; Hobby plan has 2 custom-domain slots per service; minimum $5/mo workspace spend; fractional vCPU may round up |
| **Render** | **$7.00** (Starter background worker, 512MB/0.5 CPU — over-provisioned) | **$7.00** + $25/mo Pro workspace (needed at >25 services) | ✅ REST API (OpenAPI spec available), also MCP server | ✅ Automatic Let's Encrypt; wildcard supported; 2 domains on Hobby, unlimited on Pro | **None** (paid tiers always-on) | Minimum instance is 512MB/0.5 CPU even if you only need half; $7/mo is lowest always-on tier; free tier sleeps after 15 min |
| **Kubernetes (GKE Standard, shared)** | **~$12–50** (fixed costs dominate at small scale) | **~$5–8** (amortized over shared node pool) | ✅ Full K8s API + cloud provider REST APIs | ⚠️ Requires cert-manager or ingress controller (~$20/mo LB + operational overhead) | 2–10s (pod startup + image pull) | Requires K8s expertise; cluster ops burden; egress $0.08–0.12/GB to internet; node rightsizing is non-trivial |
| **Kubernetes (EKS, shared)** | **~$15–60** (fixed costs dominate) | **~$6–10** (amortized) | ✅ Full K8s API + AWS SDK | Same as GKE | 2–10s | EKS control plane $73/mo flat fee; otherwise similar to GKE |
| **Kubernetes (GKE Autopilot)** | **~$9.05** per pod (0.25 vCPU + 256MB) | **~$9.05** per pod (linear) | ✅ Same K8s API, no node management | Same as GKE Standard | 2–10s | $0.10/hr cluster fee waived by free tier (1st cluster); no node-level access; minimum pod resource request enforced (0.25 vCPU min) |

---

## Detailed Breakdown by Provider

### 1. Fly.io — `fly machines` API

**Pricing** (source: [fly.io/docs/about/pricing](https://fly.io/docs/about/pricing/), accessed 2026-05-28):

| Resource | Rate |
|---|---|
| shared-cpu-1x@256MB (always-on, iad region) | **$2.02/mo** |
| Additional RAM | ~$5/GB/30d |
| Wildcard TLS certificate | **$1/mo** (one per org) |
| Single-hostname TLS | $0.10/mo (first 10 free) |
| Outbound bandwidth (NA/EU) | $0.02/GB |
| Outbound bandwidth (Asia Pacific/Oceania/SA) | $0.04/GB |
| Outbound bandwidth (Africa/India) | $0.12/GB |
| Stopped machine rootfs | $0.15/GB/mo |

**Reservations**: 40% discount via prepaid blocks — shared-cpu at $36/yr ($3/mo) for $5/mo compute credit. At our scale, a $36/yr block nearly halves the per-machine cost.

**API**: Full REST API at `https://api.machines.dev/v1` with OpenAPI 3.0 spec. CRUD for machines, apps, volumes, certificates, secrets. 300ms typical boot time for a cold VM ([fly.io/blog/fly-machines](https://fly.io/blog/fly-machines/)).

**Wildcard TLS**: `*.daemons.controlai.io` via `fly certs create "*.daemons.controlai.io"`. Let's Encrypt DNS-01 verification — add one CNAME record per domain. $1/mo.

**Cost examples**:
- 10 daemons: 10 × $2.02 + $1 (wildcard) = **$21.20/mo** + egress
- 100 daemons: 100 × $2.02 + $1 = **$203/mo** + egress
- With reservation: ~$1.20/daemon → 100 daemons ≈ **$121/mo**

**Gotchas**:
- No free tier for new accounts (legacy Hobby/Launch plans grandfathering ended Oct 2024)
- First deploy of a daemon requires image pull (~1-5s additional)
- Static egress IP costs $3.60/mo per IP if needed for MQTT allowlists
- Multi-region data transfer costs if egressing across regions

---

### 2. Railway — Per-second billing

**Pricing** (sources: [railway.com/pricing](https://railway.com/pricing), [checkthat.ai/brands/railway/pricing](https://checkthat.ai/brands/railway/pricing), accessed 2026-05-28):

| Resource | Rate |
|---|---|
| CPU | $0.00000772/vCPU-sec (~$20.02/vCPU/mo at continuous use) |
| Memory | $0.00000386/GB-sec (~$10.01/GB/mo) |
| Network egress | $0.05/GB |
| Volume storage | $0.15/GB/mo |
| Hobby plan | **$5/mo** (includes $5 usage credit; 50 projects × 50 services) |
| Pro plan | **$20/seat/mo** (includes $20 usage credit; 100 projects × 100 services) |

**Per-daemon compute** (assuming 0.25 vCPU allocatable, 256MB, always-on 730h/mo):
- CPU: 0.25 × $20.02 = **$5.00/mo**
- RAM: 0.256 × $10.01 = **$2.56/mo**
- Total: **$7.56/mo per daemon**

On Hobby ($5 credit): $7.56 - $5.00 = $2.56 overage → **$7.56 total** (base $5 + $2.56)
On Pro ($20 credit): within credit for 1–2 daemons; additional daemons at $7.56

**API**: GraphQL only at `https://backboard.railway.com/graphql/v2`. Project, service, variable, and deployment management via GraphQL mutations. OAuth2 + token-based auth. No REST API.

**Wildcard TLS**: Supported — `*.daemons.controlai.io` via custom domain. Automatic Let's Encrypt provisioning. Hobby plan: 2 custom-domain slots per service.

**Sleep behavior**: "App Sleeping" sleeps services after inactivity. Can be disabled via service settings for always-on daemons.

**Cost examples**:
- 10 daemons: 10 × $7.56 - $5 credit = **$70.60/mo** + egress
- 100 daemons: 100 × $7.56 - $5 credit = **$751/mo** + egress
- Alternative: use Pro ($20/seat) with 1 seat, same compute pricing

**Gotchas**:
- GraphQL-only API is less ergonomic than REST for simple CRUD operations
- Hobby plan only allows 2 custom-domain slots per service — for per-customer wildcard routing, use a single wildcard CNAME + app-level routing
- Egress at $0.05/GB can surprise; one source reported 79% of a $51.79 bill was egress
- Fractional vCPU billing may round up in practice (minimum container allocation not fully documented)
- No built-in CDN (removed in 2025)

---

### 3. Render — Background Workers / Web Services

**Pricing** (source: [render.com/pricing](https://render.com/pricing), accessed 2026-05-28):

| Instance Type | RAM | CPU | $/mo |
|---|---|---|---|
| Free (spins down after 15 min) | 512 MB | 0.1 | $0 |
| **Starter** (minimum always-on) | **512 MB** | **0.5** | **$7** |
| Standard | 2 GB | 1 | $25 |
| Pro | 4 GB | 2 | $85 |

Workspace plans: Hobby ($0, up to 25 services, 100GB bandwidth), Pro ($25/mo, unlimited, 500GB bandwidth).

**Per-daemon cost**: Minimum always-on is the Starter tier at **$7/mo** — over-provisioned (512MB/0.5 CPU for a 256MB/0.25 vCPU need). No fractional sizing available.

**API**: Full REST API at `api.render.com/v1` with OpenAPI 3.0 spec. CRUD for services, deploys, custom domains, environment groups, secrets. Also provides an MCP server.

**Wildcard TLS**: Fully supported — `*.daemons.controlai.io` with automatic Let's Encrypt provisioning. Hobby includes 2 custom domains; Pro unlimited. Documented at [render.com/docs/custom-domains](https://render.com/docs/custom-domains).

**Cost examples**:
- 10 daemons (Hobby workspace): 10 × $7 = **$70/mo** + egress (within 100GB)
- 100 daemons (Pro workspace): 100 × $7 + $25 = **$725/mo** + egress

**Gotchas**:
- Minimum Starter tier (512MB/0.5 CPU) is 2× the RAM and 2× the CPU we need — cannot downsize further
- No fine-grained per-request scaling; each daemon is a full service
- Free tier spins down after 15 min with 30–60s cold start (not viable for daemon)
- Persistent disk add-on at $0.25/GB/mo if daemon needs local state
- Bandwidth overage: $30/100GB on Hobby, but likely fine for occasional MQTT/HTTP

---

### 4. Kubernetes (Self-Hosted on EKS or GKE)

**Control plane cost**:
| Provider | Control Plane Fee |
|---|---|
| **EKS** | $0.10/hr = **$73/mo** per cluster (standard support) |
| **GKE Standard** | $0.10/hr, but **free tier** gives $74.40/mo credit → first zonal cluster **free** |
| **GKE Autopilot** | Same as Standard, free tier applies |

**Node (compute) costs** — example small nodes:

| Node Type | vCPU | RAM | $/mo (on-demand) |
|---|---|---|---|
| AWS t3.small | 2 | 2 GB | ~$15 |
| AWS t3.medium | 2 | 4 GB | ~$29 |
| GCP e2-standard-2 | 2 | 8 GB | ~$55 |
| GCP e2-standard-4 | 4 | 16 GB | ~$98 |

**Load balancer**: ~$20/mo for a TCP/HTTP LB (ALB/NLB on AWS, GLB on GCP).

**Per-daemon fit** (at 0.25 vCPU / 256MB request, with ~15% overhead for kube-system):
- CPU-bound: ~14 daemons per 4-vCPU node
- RAM-bound: ~55 daemons per 16GB node

**Cost at 50 daemons sharing a node pool**:
- GKE Standard: 4 × e2-standard-4 ($392/mo) + LB ($20/mo) + $0 control plane = **$412/mo** → **$8.24/daemon**
- EKS: 4 × t3.medium ($116/mo) + LB ($20/mo) + $73 control plane = **$209/mo** → **$4.18/daemon** (lower spec nodes)
- GKE Autopilot: 50 × $9.05 = **$452.50/mo** → **$9.05/daemon**

**Cost at 100 daemons**:
- GKE Standard: 8 × e2-standard-4 ($784/mo) + LB ($20/mo) = **$804/mo** → **$8.04/daemon**
- EKS: 7 × t3.medium ($203/mo) + LB ($20/mo) + $73 = **$296/mo** → **$2.96/daemon**
- GKE Autopilot: 100 × $9.05 = **$905/mo** → **$9.05/daemon**

**API**: Full Kubernetes API + cloud provider SDKs. cert-manager for Let's Encrypt automated wildcard certs.

**Wildcard TLS**: Via cert-manager + ClusterIssuer (Let's Encrypt). Free, but requires setup. Ingress controller (nginx, Traefik, etc.) needed to terminate TLS.

**Gotchas**:
- K8s operational complexity is significant — node upgrades, monitoring, auto-scaling, security patches
- EKS has a flat $73/mo control plane fee regardless of size
- Spot instances can reduce node costs 60–90% but risk preemption
- Inter-pod networking, CNI configuration, and egress costs add up
- For <10 daemons, overhead is massive (~$100+ cluster cost for a handful of pods)

---

### 5. Pre-Warmed Pool Strategies

**Concept**: Keep N idle (stopped/sleeping) daemon instances ready, allocate them on customer signup, wake on demand.

| Provider | Cost per Idle/Sleeping Machine | Wake Time | Notes |
|---|---|---|---|
| **Fly.io** | $0.15/GB/mo for rootfs (~$0.15/mo per stopped machine at 1GB image) | ~300ms | `fly machine create` then `fly machine start`. Machine stays provisioned. Best cold-start of any option. |
| **Railway** | $0 when sleeping (no CPU/RAM billed) | ~1–3s | "App Sleeping" — service sleeps but persists. Cold start is container restart. |
| **Render** | N/A (no sleep on paid tiers) | 0 (always-on) | Paid tiers don't sleep; free tier sleeps after 15 min with 30–60s cold start |
| **K8s** | Pod can be scaled to 0 replicas; node still paid | 2–10s | DaemonSet cannot scale to 0; would need to delete/recreate pods |

**Pool cost example (Fly.io)**: Keep 20 pre-provisioned machines stopped:
- 20 × $0.15/GB rootfs × 1GB = **$3/mo** for the pool
- ~$0.15/mo per standby daemon
- This is extremely cheap for zero cold-start allocation

**Pool cost example (Railway)**: 20 sleeping services = $0 idle cost (no compute). Only pay egress/storage. But wake time is 1–3s, which may be acceptable.

---

## Comparison Summary

| Dimension | Fly.io | Railway | Render | K8s (GKE Standard) |
|---|---|---|---|---|
| **1–10 daemons $/mo** | **$21–32** | **$71–76** | **$70** | **$100–200+** (fixed costs dominate) |
| **100 daemons $/mo** | **$203** | **$751** | **$725** | **$400–800** (with shared nodes) |
| **Provision/deprovision speed** | ~300ms API | ~2–5s (deploy) | ~30s (deploy) | ~2–10s (pod start) |
| **API quality** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ (GraphQL) | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ (K8s native) |
| **TLS ergonomics** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ (needs cert-manager) |
| **Operational overhead** | Very low | Very low | Very low | High |
| **Egress cost** | $0.02/GB NA/EU | $0.05/GB | Included up to plan limit | $0.08–0.12/GB to internet |
| **Smallest billable unit** | Fractional vCPU | Per-second CPU/RAM | $7/mo fixed per service | Per-GB per-pod on Autopilot |

---

## Recommendation

**For <100 customers: Fly.io is the clear winner.**

At $2.02/daemon/mo (or ~$1.20 with reservations), Fly.io is **3–4× cheaper** than Railway ($7.57) or Render ($7) for the same always-on workload. The full REST API with OpenAPI spec makes programmatic provision/deprovision trivial. The ~300ms cold start enables a viable pre-warmed pool at $0.15/mo per idle machine — keep a pool of 20 stopped machines for $3/mo and allocate instantly. Wildcard TLS at $1/mo flat is negligible. The only cost risk is egress for data-heavy daemons, but at $0.02/GB in NA/EU, occasional MQTT/HTTP outbound won't move the needle.

**For 100–1000 customers: Fly.io still wins, but Kubernetes (GKE Standard or bare-metal) becomes competitive.**

At 100 daemons on Fly.io: **$203/mo** (compute + wildcard cert). Using reservations: ~$120–140/mo. This scales linearly and predictably. To beat Fly.io on K8s, you'd need per-daemon costs below $2.00 — achievable with GKE Standard + committed use discounts + spot instances on aggressive bin-packing, but only if you have the operational bandwidth. The GKE free tier eliminates the $73/mo control plane fee that EKS requires, making GKE Standard the most viable K8s path.

**Railway and Render are only worth considering if** you need a single dashboard for a small number of daemons (<20) and want to avoid learning Fly.io's Machines API. Their per-daemon costs are 3–4× higher than Fly.io and they cannot match Fly's API-first provisioning model.

**Dark horse**: A single $12/mo VPS (Hetzner CX22: 2 vCPU, 4GB RAM) running 50 daemon containers behind a reverse proxy would cost **$0.24/daemon/mo** plus your own ops time. At 1000 customers, that's $240/mo in VPS costs vs $2,030/mo on Fly.io — worth considering if your team has DevOps capacity.

---

## Sources

| Source | URL | Accessed |
|---|---|---|
| Fly.io Resource Pricing | https://fly.io/docs/about/pricing/ | 2026-05-28 |
| Fly.io Machines API | https://fly.io/docs/machines/api/ | 2026-05-28 |
| Fly.io Machine boot time | https://fly.io/blog/fly-machines/ | 2026-05-28 |
| Railway Pricing | https://railway.com/pricing | 2026-05-28 |
| Railway Pricing Calculator (makerkit) | https://makerkit.dev/pricing-calculator/railway | 2026-05-28 |
| Railway GraphQL API | https://docs.railway.com/integrations/api | 2026-05-28 |
| Railway custom domains | https://docs.railway.com/networking/public-networking | 2026-05-28 |
| Railway Resource Pricing (checkthat.ai) | https://checkthat.ai/brands/indian-railways/pricing | 2026-05-28 |
| Render Pricing | https://render.com/pricing | 2026-05-28 |
| Render Custom Domains | https://render.com/docs/custom-domains | 2026-05-28 |
| Render REST API | https://render.com/docs/api | 2026-05-28 |
| AWS EKS Pricing | https://aws.amazon.com/eks/pricing/ | 2026-05-28 |
| GKE Pricing | https://cloud.google.com/kubernetes-engine/pricing | 2026-05-28 |
| GKE vs EKS cost comparison | https://dev.to/muskan_8abedcc7e12/eks-vs-gke-vs-aks-a-finops-cost-comparison-in-2026-2m12 | 2026-05-28 |
| AWS EC2 t3 pricing | https://www.economize.cloud/resources/aws/pricing/ec2/family/t3 | 2026-05-28 |

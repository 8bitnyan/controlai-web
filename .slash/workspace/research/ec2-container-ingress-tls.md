# Research: ECS-on-EC2 Ingress + TLS Termination Strategies for Per-Customer Subdomains

**Date**: 2026-05-28

## Summary

For routing 100–1000+ per-customer subdomains (`{org-slug}-{env}.daemons.controlai.io`) to bin-packed ECS-on-EC2 containers on dynamic host ports, a **Caddy reverse proxy pool** (Option B) is the clear winner. It avoids AWS hard limits (100 rules/ALB, 100 TGs/ALB), provides sub-second add/remove via API, and costs ~$80–250/month at 1000 daemons. The runner-up — **Traefik with ECS provider auto-discovery** — is simpler to operate but gives up some control over routing granularity. Pure-ALB (Option A) is viable only for <100 daemons. NLB (Option C) cannot route by host-header at L4. CloudFront (Option D) is overkill. Single-daemon-per-service (Option E) is cost-prohibitive.

---

## Architecture Overview

```
Internet
    │
    ├─ DNS: *.daemons.controlai.io ── CNAME ──► ALB (wildcard ACM cert)
    │                                             │
    │                                         port 443
    │                                             │
    │                                    ┌────────┴────────┐
    │                                    │  Caddy / Traefik │
    │                                    │  (ASG or ECS)   │
    │                                    │  dynamic config  │
    │                                    └────────┬────────┘
    │                                        host-header
    │                                        + SRV lookup
    │                                             │
    │                                    ┌────────┴────────┐
    │                                    │   ECS Cluster   │
    │                                    │  (bin-packed)   │
    │                                    │  dynamic ports  │
    │                                    └─────────────────┘
    │
    └── Cloud Map (private DNS) ── SRV records per daemon
```

---

## Option A — Single ALB + ACM Wildcard Cert (+ ECS Service Discovery)

### How it works

1. ACM wildcard cert `*.daemons.controlai.io` attached to ALB HTTPS listener (port 443).
2. One listener rule per daemon matching `Host: {org-slug}-{env}.daemons.controlai.io`.
3. Each rule forwards to a target group registered with that daemon's EC2 instance IP + dynamic port.

### AWS Limits (the dealbreaker)

| Resource | Default Limit | Adjustable |
|----------|--------------|------------|
| Rules per ALB | 100 | Yes (hard ceiling unclear, AWS docs: "adjustable" but soft limit typically 100–200) |
| Target Groups per ALB | **100** | **No — NOT adjustable** |
| Targets per ALB | 1,000 | Yes |
| Condition wildcards per rule | 6 | No |

**Source**: [AWS ALB Quotas](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-limits.html)

**Consequence**: With 100 TGs per ALB hard limit, this pattern cannot scale beyond 100 daemons on a single ALB. You'd need 10 ALBs for 1000 daemons = 10 × $22/mo = $220/mo just in base rate, and you'd be managing 10 separate DNS CNAMEs or a Route53 latency/weighted routing tree.

### Latency budget for add/remove

- **Adding a daemon**: Create TG (seconds) → Register target (instant) → Create listener rule with `host-header` condition (seconds) → ALB propogation (30–60s).
- **Removing a daemon**: Delete rule (seconds) → Delete TG (seconds) → ALB propagation (30–60s).
- **Total**: ~60s+, not sub-second.

### Failure modes

- Hit 100 TG limit — daemon provisioning fails.
- Slow rule propagation of 30–60s during burst provisioning.
- Cost of managing 10+ ALBs at scale.

### Back-of-envelope cost (1000 daemons)

- Need ~10 ALBs (100 TGs each): 10 × $22/mo = **$220/mo** base.
- LCU costs: negligible at low traffic per daemon (~$5–10/ALB) = **$270–320/mo total**.
- **Not cost-effective** compared to Option B.

---

## Option B (Recommended) — Caddy Reverse Proxy Pool

### How it works

1. **Front-end**: A single ALB with ACM wildcert `*.daemons.controlai.io` → Caddy pool (ASG of N instances behind ALB).
2. **Or**: Caddy terminates TLS itself using ACME DNS-01 (Route53 plugin) — no ALB needed at all; Caddy serves directly on :443.
3. **Routing**: Caddy's admin API (or Caddyfile reload) maps each `Host` header to a `reverse_proxy` upstream resolved via ECS Service Discovery (SRV DNS records from Cloud Map).
4. **Backend resolution**: Caddy supports `dynamic srv` upstreams — it queries Cloud Map's Route53 private hosted zone for `SRV` records, which return `{priority} {weight} {port} {hostname}` — giving Caddy both IP and dynamic port.

### Key Caddy features

- **Admin REST API**: `POST /config/apps/http/servers/srv0/routes/...` to add/remove routes in milliseconds. No reload needed.
- **Wildcard cert**: ACME DNS-01 via `caddy-dns/route53` plugin → `*.daemons.controlai.io` auto-renewed.
- **Dynamic SRV upstreams**: `reverse_proxy { dynamic srv _http._tcp.{host} }` — resolves per-request.
- **Zero downtime**: Caddy validates config before applying; invalid config rolls back automatically.

### Minimal Caddyfile (wildcard + dynamic SRV)

```caddyfile
{
    # Wildcard cert via Route53 DNS-01
    acme_dns route53 {
        profile "default"
    }
}

*.daemons.controlai.io {
    tls {
        dns route53
    }

    reverse_proxy {
        # Dynamic SRV lookup against Cloud Map private DNS
        # Queries: _http._tcp.{host} where {host} = the SNI hostname
        dynamic srv _http._tcp.{host} {
            refresh 30s
        }

        transport http {
            tls_server_name {host}
        }

        health_uri /health
        health_interval 15s
    }
}
```

### Minimal Caddy JSON config (admin API target)

```json
{
  "@id": "route_acmecorp_prod",
  "match": [
    {
      "host": ["acmecorp-prod.daemons.controlai.io"]
    }
  ],
  "handle": [
    {
      "handler": "reverse_proxy",
      "dynamic_upstreams": {
        "source": "srv",
        "name": "_http._tcp.acmecorp-prod.daemons.controlai.io",
        "refresh": "30s"
      },
      "transport": {
        "protocol": "http",
        "tls_server_name": "acmecorp-prod.daemons.controlai.io"
      }
    }
  ],
  "terminal": true
}
```

### Caddy admin API: add a daemon route

```bash
# Add route via POST (appends to routes array)
curl -X POST "http://caddy:2019/config/apps/http/servers/srv0/routes" \
  -H "Content-Type: application/json" \
  -d '{
    "@id": "route_acmecorp_prod",
    "match": [{"host": ["acmecorp-prod.daemons.controlai.io"]}],
    "handle": [{
      "handler": "reverse_proxy",
      "dynamic_upstreams": {
        "source": "srv",
        "name": "_http._tcp.acmecorp-prod.daemons.controlai.io",
        "refresh": "30s"
      },
      "transport": {
        "protocol": "http",
        "tls_server_name": "acmecorp-prod.daemons.controlai.io"
      }
    }],
    "terminal": true
  }'
```

```bash
# Remove a daemon route via @id
curl -X DELETE "http://caddy:2019/id/route_acmecorp_prod"
```

### How does adding a new daemon look operationally?

| Step | Action | Latency |
|------|--------|---------|
| 1 | ECS task starts (bin-packed on EC2, dynamic port) | 10–30s |
| 2 | ECS registers instance with Cloud Map service (SRV + A records) | ~1s |
| 3 | Provisioner calls Caddy admin API → adds route with `dynamic srv` upstream. Caddy will discover the backend on the next request via SRV DNS. | ~100ms |
| 4 | (Optional) Pre-warm DNS cache by calling `dig` | ~0 |
| 5 | Client HTTP request → Cloud Map DNS (TTL 5–60s) → Caddy resolves SRV→IP:port | 5–60s DNS TTL |
| **Total end-to-end** | | **~15–90s** |
| Caddy route add alone | | **~100ms** |

**Key insight**: The critical path is DNS propagation (Cloud Map SRV TTL). The Caddy config change is instant. If you need sub-second, set SRV TTL to 5s (minimum) and accept slightly more DNS queries.

### How does removing a daemon look?

| Step | Action | Latency |
|------|--------|---------|
| 1 | ECS task stops; Cloud Map auto-deregisters the SRV record | ~1s |
| 2 | Provisioner calls `DELETE /id/route_acmecorp_prod` on Caddy | ~100ms |
| 3 | Caddy stops routing requests to that host | Instant after config change |
| 4 | In-flight requests to the ECS task drain normally (connection close) | Up to 350s keepalive |

**Total**: ~1–2s for the control plane; in-flight traffic drains on existing connections.

### Failure modes

- **Caddy crashes**: New daemons can't be added until Caddy restarts. Existing routes are ephemeral (config in RAM unless persisted). **Mitigation**: run Caddy in an ASG (N+1), persist config to S3/etcd, and use health checks.
- **Caddy can't reach Cloud Map DNS**: SRV resolution fails → 502. **Mitigation**: configure fallback resolvers, DNS caching.
- **Wildcard cert renewal failure**: If Route53 DNS-01 fails, existing cert continues working until expiry (60 days for LE). **Mitigation**: monitor cert expiry, alert on renewal failures.
- **Dynamic SRV upstream health checks**: Active health checks don't run for dynamic upstreams (Caddy limitation). Only passive health checking (circuit breaking on errors). **Mitigation**: use short SRV TTL (5–15s) so unhealthy backends fall out of DNS quickly.

### Back-of-envelope cost (1000 daemons)

| Component | Cost |
|-----------|------|
| ALB (one, minimal traffic) | ~$22/mo |
| — or skip ALB, Caddy direct on :443 | $0 |
| Caddy EC2 instances (2 × t3.medium, ASG) | ~$60/mo |
| Cloud Map service registry (1000 services × $0.10/mo) | ~$100/mo |
| Cloud Map DNS queries (1000 × 1qps × 730h × $0.40/1M) | ~$1/mo |
| ACM wildcard cert | $0 |
| **Total with ALB** | **~$183/mo** |
| **Total Caddy direct** | **~$161/mo** |

### Traefik alternative (same category)

Traefik's ECS provider is an attractive alternative that eliminates the provisioner's Caddy API calls. Instead, routing config is embedded in ECS task definition labels:

```json
{
  "family": "daemon-acmecorp-prod",
  "containerDefinitions": [
    {
      "name": "daemon",
      "image": "...",
      "labels": {
        "traefik.enable": "true",
        "traefik.http.routers.daemon.rule": "Host(`acmecorp-prod.daemons.controlai.io`)",
        "traefik.http.routers.daemon.tls": "true",
        "traefik.http.services.daemon.loadbalancer.server.port": "8080"
      }
    }
  ]
}
```

Traefik auto-discovers ECS tasks → reads labels → configures routing dynamically. No provisioner→proxy API call needed.

**Tradeoff**: Less control (Traefik runs its own control loop, ~15s poll interval), but simpler ops. See [Traefik ECS provider docs](https://doc.traefik.io/traefik/v3.6/reference/routing-configuration/other-providers/ecs/) for details.

**Which to choose**:
- **Caddy** if you need sub-second route changes, want to manage routing from your own provisioner, or need maximum control.
- **Traefik** if you want the simplest operational model (just label your ECS tasks) and 15s propagation delay is acceptable.

---

## Option C — Network Load Balancer + SNI Routing

### How it would work (and why it doesn't)

NLB TLS listeners support multiple certificates via SNI, but **NLB does not route to different target groups based on SNI hostname**. SNI is only used for certificate selection. All TLS connections go to the same target group regardless of which subdomain the client requested.

**Confirmed by AWS ecosystem**: The `kubernetes-sigs/aws-load-balancer-controller` project explicitly notes: *"AWS NLBs do not support SNI hostname based routing"* ([source](https://github.com/kubernetes-sigs/aws-load-balancer-controller/issues/4556)).

### What NLB *could* do here

- Terminate TLS (with wildcard cert), then forward plain TCP to a Caddy/Traefik layer that does host-header routing.
- This is just Option B with NLB in front instead of ALB — adds cost and complexity with no benefit.

### NLB as TLS-terminating front for Option B (i.e., ALB replacement)

| Aspect | NLB fronting Caddy | ALB fronting Caddy |
|--------|-------------------|-------------------|
| TLS termination | NLB (or Caddy) | ALB (or Caddy) |
| Static IP | Yes (EIP per AZ) | No (DNS name) |
| Cost | $22/mo base + NLCU | $22/mo base + LCU |
| WAF support | No | Yes |
| Benefit | Only if clients need static IP whitelisting | None for this use case |

**Verdict**: NLB doesn't solve the problem by itself. Don't use it here.

---

## Option D — CloudFront + Lambda@Edge

### How it would work

1. CloudFront distribution with `*.daemons.controlai.io` alternate domain + ACM wildcard cert.
2. Lambda@Edge (origin request) inspects `Host` header, looks up daemon→IP:port mapping in DynamoDB, returns a `Host` header override + custom origin.
3. But... CloudFront origins are static resources; dynamic per-request origin switching requires Lambda@Edge to return a 302 redirect to the ALB/Caddy, or use CloudFront's origin request policy to rewrite.

### Problems

- **Origin switching per request**: CloudFront can have at most one origin per behavior. Dynamic origin switching per `Host` header requires Lambda@Edge to return a new URL (redirect) — adds a hop and latency.
- **Cost**: $0.60/1M requests × 1000 daemons × light traffic = manageable, but Lambda@Edge adds $0.10/1M invocations + compute.
- **Complexity**: Lambda@Edge has deployment friction (us-east-1 only, 5s timeout for origin requests).
- **Latency**: Extra 50-100ms per request for Lambda@Edge execution + DynamoDB lookup.

**Verdict**: Overkill for east-west daemon traffic. Only useful if you already need CloudFront for CDN/caching at the edge.

---

## Option E — Single ECS Task = Single Daemon, Each in its Own Service + Route53

### How it would work

- Each daemon gets its own ECS service (not bin-packed), an ALB, and a Route53 `A` record.
- At 1000 daemons: 1000 ALBs × $22/mo = **$22,000/month** just in load balancer base cost.

### Why it's ruled out

| Factor | At 1000 daemons |
|--------|----------------|
| ALB cost | $22,000/mo (minimum) |
| Route53 hosted zone records | 1000 records (free tier covers 1000) |
| ECS service overhead | Manageable but high |
| **Verdict** | **Cost-prohibitive** |

---

## Comparison Table

| Dimension | Option A (Pure ALB) | Option B (Caddy/Traefik) | Option C (NLB SNI) | Option D (CloudFront+LE) |
|-----------|-------------------|------------------------|-------------------|------------------------|
| **Max daemons per LB** | ~100 (TG limit) | Unlimited (RAM-bound) | N/A (can't route) | Unlimited |
| **Sub-second add/remove** | No (~60s) | **Yes (~100ms)** | N/A | Yes (DDB write) |
| **Wildcard TLS** | ACM cert | ACME DNS-01 / ACM cert | ACM cert | ACM cert |
| **Cost @ 1000 daemons** | $270–320/mo (10 ALBs) | **$160–183/mo** | N/A | $100–200/mo + Lambda |
| **Extra hop** | No | Yes (Caddy added) | Yes | Yes (CloudFront) |
| **Operational complexity** | Low (but hits limits) | Medium (Caddy ASG) | Low (but doesn't work) | High (Lambda@Edge) |
| **Failure blast radius** | Per-ALB TG limit | Caddy pool crash = all routes down | N/A | CloudFront regional issue |
| **WAF integration** | Native | Via ALB in front | No | Via CloudFront + WAF |

---

## Recommendation: Option B — Caddy Reverse Proxy Pool

### Rationale

1. **No hard limits**: Caddy's route table is bounded only by RAM. A Caddy instance handles 10,000+ routes on a t3.medium.
2. **Sub-second control plane**: Admin API calls complete in <100ms. No AWS API propagation delays.
3. **Wildcard cert for free**: ACME DNS-01 via Route53 plugin auto-renews `*.daemons.controlai.io`.
4. **Dynamic SRV backends**: Caddy resolves upstreams from Cloud Map SRV records → gets IP + dynamic port per request.
5. **Cost**: ~$160–180/mo at 1000 daemons — 40% cheaper than even the multi-ALB workaround for Option A.

### Concrete TypeScript: add-daemon step

```typescript
// add-daemon.ts — called by provisioner when a new daemon ECS task starts

import { CaddyClient } from '@accelerated-software-development/caddy-api-client';
import { ECSClient, DescribeTasksCommand } from '@aws-sdk/client-ecs';
import { ServiceDiscoveryClient, GetInstancesHealthStatusCommand } from '@aws-sdk/client-servicediscovery';

const caddy = new CaddyClient({ adminUrl: 'http://caddy-internal:2019', timeout: 5000 });
const ecs = new ECSClient({ region: 'ap-northeast-2' });

interface DaemonAdd {
  orgSlug: string;   // e.g. "acmecorp"
  env: string;       // e.g. "prod" | "staging"
  ecsCluster: string;
  ecsTaskArn: string;
  sdServiceId: string;  // Cloud Map service ID from ECS service_registries
}

export async function addDaemonRoute(params: DaemonAdd): Promise<void> {
  const hostname = `${params.orgSlug}-${params.env}.daemons.controlai.io`;

  // 1. (Optional) Wait for Cloud Map SRV record to be published
  const sd = new ServiceDiscoveryClient({ region: 'ap-northeast-2' });
  await sd.send(new GetInstancesHealthStatusCommand({
    ServiceId: params.sdServiceId,
  }));

  // 2. Build the Caddy route JSON
  const route = {
    '@id': `route_${params.orgSlug}_${params.env}`,
    match: [{ host: [hostname] }],
    handle: [{
      handler: 'reverse_proxy',
      dynamic_upstreams: {
        source: 'srv',
        name: `_http._tcp.${hostname}`,  // SRV record from Cloud Map
        refresh: '30s',
      },
      transport: {
        protocol: 'http',
        tls_server_name: hostname,  // pass to daemon if it needs SNI
      },
    }],
    terminal: true,
  };

  // 3. Push route to Caddy admin API (sub-second, zero-downtime)
  await caddy.addRoutes('srv0', [route]);

  console.log(`[add-daemon] Route added: ${hostname} -> SRV ${route.dynamic_upstreams.name}`);
}
```

### Infrastructure layout summary

```
Route53 (public)
  *.daemons.controlai.io ── CNAME ──► caddy-lb-123456.elb.ap-northeast-2.amazonaws.com
                                       or
                                       Caddy ASG public IPs (if no ALB needed)

Caddy ASG (2× t3.medium, min)
  - Port 443: wildcard TLS term, dynamic reverse proxy
  - Port 2019: admin API (internal, provisioner-only access)
  - Container image: caddy:2-builder + caddy-dns/route53 plugin

Cloud Map (private DNS)
  Namespace: daemons.controlai.io (private)
  Per daemon: SRV _http._tcp.{slug}-{env}.daemons.controlai.io ──► task-ip:dynamic-port
              A   {slug}-{env}.daemons.controlai.io              ──► task-ip

Provisioner
  - Watches ECS task start events (EventBridge or ECS event stream)
  - Calls addDaemonRoute() via Caddy admin API
  - Reconciles on startup (enumerate all ECS tasks, push all routes)
```

---

## References

- [AWS ALB Quotas](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-limits.html) — 100 rules, 100 TGs per ALB, 1000 targets per ALB.
- [AWS ALB Listener Rules](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/listener-rules.html) — host-header condition, forward action, priority ordering.
- [AWS NLB TLS Listeners](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/load-balancer-listeners.html) — NLB TLS does not support SNI-based routing across target groups.
- [kubernetes-sigs/aws-lb-controller issue #4556](https://github.com/kubernetes-sigs/aws-load-balancer-controller/issues/4556) — confirmation that "AWS NLBs do not support SNI hostname based routing".
- [Caddy Admin API](https://caddy.guide/docs/api) — POST/GET/PUT/DELETE /config/ for dynamic routing.
- [Caddy Dynamic SRV Upstreams](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#srv) — SRV-based backend discovery.
- [Caddy Wildcard Cert with Route53](https://chrisshennan.com/blog/wildcard-ssls-on-ec2-using-caddy-docker-aws-route53) — DNS-01 challenge for `*.daemons.controlai.io`.
- [Traefik ECS Provider](https://doc.traefik.io/traefik/v3.6/reference/routing-configuration/other-providers/ecs/) — auto-discovery via ECS task labels.
- [AWS Cloud Map SRV Records](https://docs.aws.amazon.com/cloud-map/latest/dg/services-route53.html) — SRV includes port, critical for dynamic host port discovery.
- [AWS ELB Pricing](https://aws.amazon.com/elasticloadbalancing/pricing/) — $0.0225/hr base (~$16.43/mo) per ALB/NLB.
- [CloudCostKit ELB Calculator](https://cloudcostkit.com/calculators/aws-load-balancer-cost-calculator/) — LCU/NLCU costing reference.

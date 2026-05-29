# Research: ECS-on-EC2 Daemon Fleet — Operational Concerns

**Date:** 2026-05-28

**Objective:** Evaluate operational patterns for a fleet of ~1000 per-customer daemon containers running on ECS with EC2 launch type. Cover secrets management, multi-tenancy isolation, cluster sizing, provisioning idempotency, observability, cost, and local dev.

---

## 1. Token Injection / Secrets Handling

### The constraint

Each daemon gets a fresh `DAEMON_BEARER_TOKEN` (32-byte hex) at provision time. This is a per-daemon secret, never shared across daemons.

### Options evaluated

#### Option A — Plaintext environment variable in task definition (❌ reject)

```json
{
  "containerDefinitions": [{
    "name": "daemon",
    "image": "...",
    "environment": [
      { "name": "DAEMON_BEARER_TOKEN", "value": "a1b2c3d4e5f6..." }
    ]
  }]
}
```

**Risks:**
- The token appears **in plaintext** in `RegisterTaskDefinition` CloudTrail events — any principal with `cloudtrail:LookupEvents` can retrieve it retroactively.
- Anyone with `ecs:DescribeTaskDefinition` can read it via the API (no IAM condition can scope this to individual containers).
- The token persists in the task definition revision forever — rotating it requires registering a new revision.

**Verdict:** Unacceptable for production. Do not use.

#### Option B — AWS Secrets Manager (moderate cost, high friction)

Per-daemon secret: $0.40/secret/month × 1000 daemons = **$400/month** before API charges ($0.05 per 10k API calls). Secrets Manager has a per-secret pricing model that adds up fast at this scale.

**Task definition reference:**

```json
{
  "containerDefinitions": [{
    "name": "daemon",
    "image": "...",
    "secrets": [
      {
        "name": "DAEMON_BEARER_TOKEN",
        "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789012:secret:controlai/daemon/org-abc123-def"
      }
    ]
  }]
}
```

**Execution role policy:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:us-east-1:123456789012:secret:controlai/daemon/*"
    },
    {
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "arn:aws:kms:us-east-1:123456789012:key/alias/controlai-daemon-secrets"
    }
  ]
}
```

#### Option C — SSM Parameter Store SecureString ✅ RECOMMENDED

- **Free** for standard parameters (up to 10,000 per account at no charge). Advanced parameters are $0.05/param/month after the first 10k.
- Encryption via KMS with a customer-managed key.
- No auto-rotation (not needed here — tokens are generated once per provision).
- Same injection mechanism via `secrets[]` as Secrets Manager.

**Task definition reference:**

```json
{
  "containerDefinitions": [{
    "name": "daemon",
    "image": "...",
    "secrets": [
      {
        "name": "DAEMON_BEARER_TOKEN",
        "valueFrom": "arn:aws:ssm:us-east-1:123456789012:parameter/controlai/daemon/org-abc123-def/token"
      }
    ]
  }]
}
```

**Execution role policy:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters"
      ],
      "Resource": "arn:aws:ssm:us-east-1:123456789012:parameter/controlai/daemon/*"
    },
    {
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "arn:aws:kms:us-east-1:123456789012:key/alias/controlai-daemon-ssm"
    }
  ]
}
```

### Recommendation

**Use SSM Parameter Store SecureString.** At 1000 daemons this is free vs. $400/mo for Secrets Manager. The injection mechanism is identical (`secrets[]` container definition → `valueFrom` ARN). Execution role needs `ssm:GetParameters` + `kms:Decrypt` scoped to the `/controlai/daemon/*` path.

Keep the KMS key with a monthly rotation period and restrict `kms:Decrypt` to only the ECS execution role ARN.

---

## 2. Multi-Tenancy Isolation

### Isolation layers evaluated

| Layer | Feasibility at 1000 daemons | Verdict |
|-------|----------------------------|---------|
| **Per-daemon VPC + subnet** | ~1000 VPCs × $0.01/hr = $7,300/mo + IP exhaustion | ❌ Overkill |
| **Per-daemon security group** | AWS SG limit: 2500/region (default), 5000 (soft). One SG per daemon hits limit at 2.5k. Additional SGs per ENI also limited. | ❌ Hits limits |
| **Per-daemon IAM task role** | No hard limit on roles (5000 roles per account default, 10k+, soft). Role name includes daemon ID. | ✅ **Recommended** |
| **Per-daemon execution role** | Same approach, but most daemons share the same execution needs (pull image, resolve SSM, write logs). A single execution role with wildcard-resourced SSM path + log group is sufficient. | ✅ Single execution role |

### Recommendation: shared SG + shared subnet + per-daemon **task IAM role**

- **Subnet:** Shared private subnet(s) across all daemons (awsvpc network mode).
- **Security group:** One shared SG. Egress: **HTTPS (443) only** to 0.0.0.0/0. Ingress: none (daemons are outbound-only; ALB frontend terminates inbound).
- **Task IAM role:** One role per daemon, named `controlai-daemon-<org-id>`. The task definition's `taskRoleArn` points to this per-daemon role.

**Task IAM role trust policy:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ecs-tasks.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

Attach least-privilege permissions scoped to the specific daemon's resources (e.g., S3 prefix, DynamoDB partition, KMS key).

**Critical security note for ECS-on-EC2 (ECScape):** Per the [AWS documentation](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/security-iam-roles.html) and the [ECScape research](https://naorhaziz.com/posts/ecscape-iam-privilege-boundaries-in-ecs/): *"For EC2 and External Container Instances on ECS, there is no task isolation (unlike with Fargate). Containers can potentially access credentials for other tasks on the same container instance."*

**Mitigations:**
1. Block IMDS access per the [Latacora guide](https://www.latacora.com/blog/2025/10/02/ecs-on-ec2-covering-gaps-in-imds-hardening/): set `ECS_AWSVPC_BLOCK_IMDS=true` in `/etc/ecs/ecs.config` (already default on Bottlerocket with `awsvpc` mode).
2. Do **not** co-locate high-privilege tasks with other tasks on the same host. For daemons with identical trust boundaries (all equally low-privilege), co-location is acceptable.
3. If any daemon requires elevated privileges, isolate it via dedicated host or use Fargate.

---

## 3. Cluster Sizing + Auto-Scaling

### Architecture: ECS Capacity Provider + ASG with managed scaling

ECS **managed scaling** (enabled via `AsgCapacityProvider`) creates two CloudWatch metrics and a target-tracking scaling policy on the ASG. The capacity provider's `targetCapacityPercent` governs utilization.

### Target utilization

Set `targetCapacityPercent: 70` (meaning ECS tries to keep 70% of the ASG's memory/cpu capacity utilized). This leaves 30% headroom for scale-in safety and new task placement bursts.

### CDK snippet (TypeScript) — cluster + capacity provider + ASG + ALB

```typescript
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';

export class DaemonClusterStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'DaemonVpc', {
      maxAzs: 3,
      natGateways: 1,
    });

    // Security group: egress HTTPS only, no ingress
    const daemonSg = new ec2.SecurityGroup(this, 'DaemonSecurityGroup', {
      vpc,
      description: 'Shared SG for daemon fleet — egress 443 only',
      allowAllOutbound: false,
    });
    daemonSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443));

    // ECS cluster with Container Insights
    const cluster = new ecs.Cluster(this, 'DaemonCluster', {
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENHANCED,
      clusterName: 'controlai-daemon-cluster',
    });

    // Auto Scaling Group — t3.large, 8GB mem each
    const asg = new autoscaling.AutoScalingGroup(this, 'DaemonASG', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.LARGE),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2023(),
      minCapacity: 3,
      maxCapacity: 50,
      desiredCapacity: 5,
      blockDevices: [{
        deviceName: '/dev/xvda',
        volume: autoscaling.BlockDeviceVolume.ebs(30, { encrypted: true }),
      }],
      updateType: autoscaling.UpdateType.REPLACING_UPDATE,
      groupMetrics: [autoscaling.GroupMetrics.all()],
    });

    // Capacity Provider with managed scaling at 70% target
    const capacityProvider = new ecs.AsgCapacityProvider(this, 'DaemonCapacityProvider', {
      autoScalingGroup: asg,
      targetCapacityPercent: 70,
      enableManagedScaling: true,
      enableManagedTerminationProtection: true,
      enableManagedDraining: true,
      instanceWarmupPeriod: 120, // seconds — matches EC2 cold-start
    });
    cluster.addAsgCapacityProvider(capacityProvider);

    // ALB for health-check / status endpoint (optional for daemon fleet)
    const alb = new elbv2.ApplicationLoadBalancer(this, 'DaemonALB', {
      vpc,
      internetFacing: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    // Outputs
    new cdk.CfnOutput(this, 'ClusterName', { value: cluster.clusterName });
    new cdk.CfnOutput(this, 'CapacityProviderName', {
      value: capacityProvider.capacityProviderName,
    });
  }
}
```

### Cold-start latency

Capacity provider + managed scaling must launch a new EC2 instance when utilization exceeds 70%. Typical timeline:
- ASG scale-out alarm fires → Launch EC2 instance: **~90–120s**
- ECS agent registers with cluster, agent pulls first task image: **+30–60s**
- Daemon container starts: **+5–10s**

**Total cold-start: ~2–3 minutes.**

**Is this acceptable?** For first-of-the-day provisioning, yes, **if** the provisioning workflow is asynchronous: the provisioner writes an "intent" to the DB, returns PENDING to the caller, and a follow-up poll or webhook reports READY when the task is healthy. Synchronous blocking for 2+ minutes would be a poor UX.

**Mitigations for latency-sensitive paths:**
- **Warm pool:** Keep a small ASG buffer (min 3 instances) with the daemon container image pre-pulled via a sidecar or AMI bake.
- **Scheduled overprovisioning:** Predict peak hours (e.g., 8–10 AM) and increase `desiredCapacity` during the window.
- **Consider Fargate** for the first-N daemons (sub-second cold-start) and EC2 for steady-state. The CDK supports mixed capacity provider strategies.

---

## 4. Provisioning Idempotency + Failure Recovery

### The failure mode

```
provision(orgId) —> RegisterTaskDefinition —> RunTask —> task RUNNING —> return to caller
                                                    ^
                                                    |
                                          timeout / crash at this boundary
```

If `RunTask` succeeds (task is RUNNING on AWS) but the API response is lost (HTTP 504, crash of the provisioner), the caller sees a failure. Retrying will create a **duplicate task**.

### Recommended pattern: Intent-first with reconciliation

```
┌──────────────┐    1. Write intent      ┌──────────────┐
│ Provisioner  │ ──────────────────────►  │   DynamoDB   │
│ (idempotent) │                          │  daemon_intent│
│              │ ◄─── 2. Ack (PENDING)   │  PK: orgId   │
│              │                          │  status:     │
│              │                          │  PROVISIONING│
│              │                          │  clientToken:│
│              │                          │  (uuid)      │
│              │    3. RunTask(w/ clientToken)           │
│              │ ──────────────────────►  │   ECS API    │
│              │ ◄── 4. taskArn (or fail) │              │
│              │                          │              │
│              │    5. Update row         │              │
│              │ ──────────────────────►  │ taskArn,     │
│              │                          │ status=RUNNING│
│              │    6. Return success     │              │
└──────────────┘                          └──────────────┘
```

**Key elements:**

1. **Atomic first-write:** Write the intent row with status `PROVISIONING` and a unique `clientToken` (UUIDv4). If this fails, the entire operation aborts (no orphan task).
2. **Idempotent RunTask:** Pass the `clientToken` to the ECS `RunTask` API. ECS deduplicates for 24 hours ([documented here](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/ECS_Idempotency.html)). If a retry occurs, `RunTask` returns the original `taskArn` instead of creating a duplicate.
3. **DB row as source of truth:** On success, update the row with `taskArn` + `status=RUNNING`. On failure, set `status=FAILED` and include the error.
4. **Reconciliation cron:** A periodic sweep looks for:
   - Rows with `status=PROVISIONING` for > 5 minutes — likely orphan intent (RunTask succeeded but callback lost). Calls `DescribeTasks` to check; if task exists, updates row; if not, marks FAILED.
   - Running tasks with **no** corresponding DB row (manual cleanup artifact) — sends alert and optionally stops the task.

### Comparison to k8s controller pattern

| Aspect | k8s controller | Our pattern |
|--------|----------------|-------------|
| Core loop | Reconciliation loop, single source of truth (etcd) | Intent-first write + cron reconciliation |
| Deduplication | Object name uniqueness | `clientToken` (24h TTL) |
| Orphan handling | Re-reconciled on next loop iteration | Cron sweep (5min interval) |
| Complexity | High (operator framework, informers, caches) | Low (few hundred lines, no framework) |
| Maturity | Battle-tested but complex | Simpler for single-purpose daemon |

**Recommendation:** Use the intent-first + `clientToken` pattern. It's simpler than importing a full k8s-controller pattern, and the ECS `RunTask` idempotency guarantee (24h TTL) is sufficient for this use case. Keep the reconciliation cron as a safety net, not the primary path.

---

## 5. Observability

### CloudWatch Logs

**Per-container log group vs shared:** Shared log group (`/ecs/controlai/daemon`) with per-task log streams (`daemon-<orgId>`).

**Cost estimate for 1000 daemons with light traffic:**
- Assume each daemon writes ~100 KB of logs per hour (health checks + periodic heartbeats).
- 1000 daemons × 100 KB/hr × 730 hr/mo = **~73 GB/month** ingested.
- CloudWatch Logs ingest: $0.50/GB = **$36.50/mo**.
- Storage (assume 30-day retention): $0.03/GB/mo × 73 GB × 1 month retention ≈ negligible.
- **Total logs: ~$37/mo** at light traffic.

If each daemon writes 1 MB/hr, that becomes ~$365/mo. Consider **structured logging** and log-level controls to keep volume down.

### Container Insights vs ADOT

| Approach | Cost (1000 tasks) | What you get |
|----------|-------------------|--------------|
| **Container Insights (standard)** | ~$0.30/metric for first 10k metrics; ~22 metrics/task + 8/service + 11/cluster ≈ **~$220/mo** at 1000 tasks | Aggregated cluster + service + task metrics (CPU, memory, network) |
| **Container Insights (enhanced)** | ~$0.07/metric; 22 metrics/task + 26/service + 24/cluster + 20/container ≈ **~$500–700/mo** at 1000 tasks | Per-container granular metrics, container-level visibility |
| **ADOT collector → Prometheus + AMP** | AMP: $0.90/mo per 50 GB ingested + Grafana workspace ~$50/mo. Total ~**$150–250/mo** | Full Prometheus flexibility, custom metrics, multi-cluster |

**Recommendation:** Start with **Container Insights (standard)** enabled on the cluster. It's a checkbox (`containerInsightsV2: ecs.ContainerInsights.ENHANCED` in CDK) and provides enough CPU/memory/network visibility at the task level. Add ADOT + AMP only if you need custom metrics from inside the daemon (e.g., per-org request latency histograms).

### Tagging convention

Required tags on **every** resource (task definitions, log groups, SSM parameters, IAM roles, ECS services):

| Tag | Value | Purpose |
|-----|-------|---------|
| `controlai/org-id` | `org_abc123` | Per-customer billing |
| `controlai/environment` | `production` or `staging` | Environment isolation |
| `controlai/created-by` | `provisioner` | Origin attribution |
| `controlai/daemon-id` | `<uuid>` | Cross-reference to DB row |

Apply tags via the `--tags` flag on `RunTask` and on the task definition. CloudWatch Logs and Container Insights metrics can be filtered by tag via tag-based resource groups.

---

## 6. Cost at Steady State (1000 daemons)

### Assumptions
- Daemon: 256 MB memory, 0.25 vCPU (burstable on t3.large).
- Each t3.large: 2 vCPU, 8 GB RAM → can fit ~30 daemons per host (some overhead for OS + ECS agent ≈ ~300 MB).
- 1000 daemons ÷ 30/host ≈ **34 hosts** (round up to 35 for HA headroom).

### Compute

| Item | Calculation | Monthly Cost |
|------|-------------|-------------|
| EC2 t3.large (reserved 1yr, partial upfront) | 35 × ~$0.068/hr × 730 hr | **~$1,735** |
| EC2 t3.large (3yr reserved) | 35 × ~$0.044/hr × 730 hr | **~$1,124** |
| EC2 t3.large (on-demand) | 35 × ~$0.104/hr × 730 hr | **~$2,657** |

**Savings Plan** (compute): 1yr partial upfront ≈ 40% off → **~$1,600/mo**.

### Networking

| Item | Calculation | Monthly Cost |
|------|-------------|-------------|
| NLB (needed for daemon egress or health checks) | $0.0225/hr × 730 hr | **$16.43** |
| NLB LCU (assume minimal) | ~$3–5/mo | **$5** |
| NAT Gateway (1 × private subnet egress) | $0.062/hr × 730 hr | **$45.26** |
| Data transfer (egress, light) | ~500 GB/mo × $0.09/GB | **$45** |

**Networking total: ~$110/mo**

### Secrets storage

| Item | Calculation | Monthly Cost |
|------|-------------|-------------|
| SSM Standard parameters (first 10k free) | 1000 params, all standard tier | **$0** |

### Logging

| Item | Calculation | Monthly Cost |
|------|-------------|-------------|
| CloudWatch Logs ingest (100 KB/hr/daemon) | 73 GB × $0.50 | **$36.50** |
| Container Insights (standard) | ~$220/mo estimate | **$220** |

**Logging + monitoring total: ~$257/mo**

### Summary comparison

| Scenario | Monthly Cost | Notes |
|----------|-------------|-------|
| **EC2 (1yr reserved) + SSM + CW Logs + CI** | **~$1,967/mo** | Recommended baseline |
| **EC2 (3yr reserved) + SSM + minimal logs** | **~$1,527/mo** | Lowest cost, long commit |
| **Fargate (on-demand, x86, 256MB/0.25vCPU)** | 1000 × $8.10/mo = **$8,100/mo** | 4× more expensive |
| **Fargate (1yr SP, ARM/Graviton)** | 1000 × $4.05/mo = **$4,050/mo** | 2× more expensive |

> **Fargate equivalent calculation (256 MB, 0.25 vCPU):**
> - 0.25 vCPU × $0.04048/hr × 730 hr = $7.39
> - 0.25 GB × $0.004445/hr × 730 hr = $0.81
> - **Total per daemon: ~$8.20/mo** on-demand x86
> - With 1yr Compute SP (~50% off): ~$4.10/mo per daemon

**Bottom line:** EC2 launch type is **~4× cheaper** than Fargate at 1000-daemon scale. The cost difference of ~$2,000–6,000/mo easily justifies the operational complexity of managing an ASG.

---

## 7. Local Dev Story

### Constraint

When `ECS_PROVISIONER_ENABLED=true` is set (staging/prod), the provisioner calls ECS APIs. Local dev environments cannot test against real AWS ECS.

### Current state

The `MockProvisioner` interface exists as the local-dev default. This is correct and must remain the default.

### Boundary

```
┌──────────────────────────────────────────────────────┐
│  provisionerFactory(request): Provisioner            │
│                                                      │
│  if env.ECS_PROVISIONER_ENABLED === 'true'           │
│    → EcsProvisioner (RegisterTaskDef + RunTask +     │
│       SSM put-parameter)                             │
│  else                                                │
│    → MockProvisioner (writes to in-memory map,       │
│       returns taskArn mock, stores token in          │
│       local .env or filesystem)                      │
│                                                      │
│  MockProvisioner fulfills the same interface:        │
│    provision(orgId, config) → ProvisionResult        │
│    deprovision(orgId) → void                         │
│    getStatus(orgId) → DaemonStatus                   │
└──────────────────────────────────────────────────────┘
```

**MockProvisioner must:**
- Accept a `DAEMON_BEARER_TOKEN` (or generate one) and write it to a local file (e.g., `.daemon-tokens/org-abc123.token`) for the local daemon to read.
- Return a fake `taskArn` (e.g., `arn:aws:ecs:local:000000000000:task/mock-org-abc123`).
- Reflect status changes when the local daemon process starts/stops.
- Log all operations to stdout for debugging.

**What the MockProvisioner does NOT need to cover:**
- ECS API throttling or rate limits
- SSM parameter hierarchy or KMS key permissions
- CloudWatch log group creation
- IAM role trust policy validation
- ASG scaling or capacity provider behavior

These are integration/e2e test concerns that run in the staging AWS account, not locally.

### Documentation for the spec author

The spec should explicitly state: *"The provisioner interface MUST be mockable. The default implementation for local `npm run dev` is `MockProvisioner`. The `EcsProvisioner` is only instantiated when `ECS_PROVISIONER_ENABLED=true` is set."*

---

## Checklist of Decisions for the Spec Author

Answer these **before** writing the spec:

### Secrets (Section 1)

1. **Use SSM Parameter Store SecureString for token storage?** (Yes/No — recommended: Yes)
2. **Use Secrets Manager instead of SSM?** (Yes = $400/mo extra; only if rotation policy requires it)
3. **Use a shared execution role for all daemons, or one per daemon?** (Recommended: **shared** — only token paths differ)
4. **Use a customer-managed KMS key for SSM encryption, or AWS-managed?** (Recommended: **customer-managed** for auditability)

### Multi-tenancy isolation (Section 2)

5. **Per-daemon IAM task role?** (Recommended: **Yes** — role name = `controlai-daemon-<orgId>`)
6. **Block IMDS on ECS instances?** (Recommended: **Yes** — set `ECS_AWSVPC_BLOCK_IMDS=true`)
7. **Shared security group (egress 443 only)?** (Recommended: **Yes**)
8. **Dedicated hosts for high-privilege daemons?** (Yes if any daemon will have elevated IAM permissions)

### Cluster + scaling (Section 3)

9. **Use ECS managed scaling (Capacity Provider) or manual ASG scaling?** (Recommended: **managed**)
10. **Target capacity percent?** (Recommended: **70** — leave 30% headroom)
11. **Warm pool for cold-start mitigation?** (Recommended: **Yes** if sub-2min provisioning is a requirement)
12. **Accept ~2–3 min cold-start on first-of-day provision?** (Yes/No — if No, use Fargate for first-N daemons)
13. **EC2 instance type?** (Recommended: **t3.large** — cost/performance sweet spot)
14. **Reserved Instances or Savings Plan?** (Recommended: **1yr Compute SP** — saves ~40% vs on-demand)

### Provisioning (Section 4)

15. **Use intent-first pattern with DB row written before ECS API call?** (Recommended: **Yes**)
16. **Use ECS `clientToken` for idempotent `RunTask`?** (Recommended: **Yes**)
17. **Reconciliation cron for orphan detection?** (Recommended: **Yes** — 5-minute interval, lambda or ECS task)

### Observability (Section 5)

18. **Container Insights (standard) or (enhanced)?** (Recommended: **standard** initially, upgrade to enhanced if per-container metrics are needed)
19. **Shared CloudWatch log group or per-daemon?** (Recommended: **shared** — `/ecs/controlai/daemon` — with per-daemon log streams)
20. **Tag all resources with `controlai/org-id`?** (Recommended: **Yes** — mandatory for per-customer billing)
21. **Use ADOT + AMP for custom metrics, or stick with Container Insights?** (Recommended: **Container Insights only** unless custom business metrics required)

### Local dev (Section 7)

22. **MockProvisioner stays as local-dev default?** (Recommended: **Yes** — non-negotiable)

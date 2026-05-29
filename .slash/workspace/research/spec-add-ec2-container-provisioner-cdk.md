# CDK Reference: ECS-on-EC2 Daemon Fleet with ALB + Caddy

**Date:** 2026-05-28
**Audience:** TypeScript coder agent implementing `packages/infra/` for the `add-ec2-container-provisioner` change
**Architecture context:** See [ec2-container-provisioner-design.md](./ec2-container-provisioner-design.md) and [ec2-container-ingress-tls.md](./ec2-container-ingress-tls.md)

---

## 1. Project Layout

### Directory structure

```
packages/infra/
├── package.json
├── cdk.json
├── tsconfig.json
├── bin/
│   └── cdk.ts              # App entry; instantiates stacks
└── lib/
    ├── network-stack.ts     # VPC + VPC endpoints
    ├── ecs-stack.ts         # Cluster, ASG, capacity provider, IAM, ECR, KMS, Logs
    ├── dns-stack.ts         # Route53 hosted zone + ACM cert
    ├── ingress-stack.ts     # ALB + Caddy Fargate + Cloud Map
    └── monitoring-stack.ts  # SNS + CloudWatch alarms
```

### `packages/infra/package.json`

```json
{
  "name": "@controlai-web/infra",
  "private": true,
  "scripts": {
    "synth": "cdk synth --quiet",
    "diff": "cdk diff",
    "deploy": "cdk deploy",
    "deploy:all": "cdk deploy --all --require-approval never"
  },
  "dependencies": {
    "aws-cdk-lib": "^2",
    "constructs": "^10"
  },
  "devDependencies": {
    "aws-cdk": "^2",
    "typescript": "^5.6",
    "@types/node": "^22"
  }
}
```

**Note:** `@controlai-web/infra` must be added to `pnpm-workspace.yaml` at the repo root:

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
```

### `packages/infra/cdk.json`

```json
{
  "app": "npx tsx bin/cdk.ts",
  "watch": {
    "include": ["**"],
    "exclude": ["cdk.out"]
  },
  "context": {
    "@aws-cdk/aws-lambda:recognizeLayerVersion": true,
    "@aws-cdk/core:checkSecretUsage": true,
    "@aws-cdk/core:target-partitions": ["aws"],
    "@aws-cdk/aws-ecs:arnFormatIncludesClusterName": true
  }
}
```

**Why `npx tsx`:** The project uses `tsx` (a zero-config TypeScript executor) as the app command — it avoids the `ts-node` ESM/cjs dance. Compatible with `module: "ESNext"` in tsconfig.

### `packages/infra/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist"
  },
  "include": ["bin/**/*.ts", "lib/**/*.ts"]
}
```

### `packages/infra/bin/cdk.ts`

This is the App entry. It instantiates all stacks and wires cross-stack references through constructor props.

```typescript
#!/usr/bin/env tsx
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { EcsStack } from '../lib/ecs-stack';
import { DnsStack } from '../lib/dns-stack';
import { IngressStack } from '../lib/ingress-stack';
import { MonitoringStack } from '../lib/monitoring-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: 'ap-northeast-2',
};

// Env context for per-environment overrides (optional)
const stage = app.node.tryGetContext('stage') ?? 'dev';

// --- Stacks (bottom-up dependency order) ---

// 1. Network — no deps
const network = new NetworkStack(app, `controlai-network-${stage}`, {
  env,
  description: 'VPC, subnets, VPC endpoints for daemon fleet',
  terminationProtection: stage === 'prod',
});

// 2. DNS — no infra deps, but creates the hosted zone + wildcard cert
const dns = new DnsStack(app, `controlai-dns-${stage}`, {
  env,
  description: 'Route53 hosted zone daemons.controlai.io + wildcard ACM cert',
  terminationProtection: stage === 'prod',
});

// 3. ECS — depends on network VPC
const ecs = new EcsStack(app, `controlai-ecs-${stage}`, {
  env,
  vpc: network.vpc,
  description: 'ECS cluster, ASG capacity provider, IAM roles, ECR repo, KMS key, log group',
  terminationProtection: stage === 'prod',
});

// 4. Ingress — depends on network VPC, DNS cert, ECS cluster for Caddy service
const ingress = new IngressStack(app, `controlai-ingress-${stage}`, {
  env,
  vpc: network.vpc,
  certificate: dns.certificate,
  hostedZone: dns.hostedZone,
  cluster: ecs.cluster,
  description: 'ALB, Caddy Fargate service, Cloud Map namespace, DNS alias',
  terminationProtection: stage === 'prod',
});

// 5. Monitoring — depends on ECS cluster and ingress ALB
new MonitoringStack(app, `controlai-monitoring-${stage}`, {
  env,
  cluster: ecs.cluster,
  alb: ingress.alb,
  description: 'SNS topic + CloudWatch alarms for daemon fleet',
  terminationProtection: stage === 'prod',
});

// Tag everything
cdk.Tags.of(app).add('Project', 'controlai-web');
cdk.Tags.of(app).add('Stack', stage);
cdk.Tags.of(app).add('ManagedBy', 'cdk');

app.synth();
```

**Key pattern:** Each stack receives only the constructs it needs (not entire sibling stacks). `DnsStack` exports `certificate` and `hostedZone`. `EcsStack` exports `cluster`. `IngressStack` exports `alb` and `caddyAdminEndpoint`.

---

## 2. NetworkStack

**File:** `lib/network-stack.ts`

**Imports:**
```typescript
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
```

**Stack props interface:**
```typescript
export interface NetworkStackProps extends cdk.StackProps {
  // No cross-stack inputs — network is the foundation
}
```

**VPC with specific CIDR + subnet layout:**
```typescript
export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'DaemonVpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.20.0.0/16'),
      maxAzs: 2,
      natGateways: 1,             // single NAT in AZ-a to save cost
      natGatewayProvider: ec2.NatProvider.gateway(),

      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'private',
          // SubnetType.PRIVATE_WITH_EGRESS = private + NAT route
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });
    // ...
  }
}
```

**CIDR breakdown:**
- `10.20.0.0/16` = 65,536 IPs
- 2 AZs × (1 public `/24` + 1 private `/24`) = 4 subnets × 256 IPs = 1,024 IPs
- Leaves ~64,512 IPs unused for future expansion

**VPC Endpoints (required for ECS + Secrets Manager + monitoring):**

```typescript
// Gateway endpoint for S3 (free, no hourly cost)
this.vpc.addGatewayEndpoint('S3Endpoint', {
  service: ec2.GatewayVpcEndpointAwsService.S3,
});

// Interface endpoints (hourly cost ~$7/mo each per AZ)
this.vpc.addInterfaceEndpoint('EcrApiEndpoint', {
  service: ec2.InterfaceVpcEndpointAwsService.ECR,          // ECR API
  privateDnsEnabled: true,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
});

this.vpc.addInterfaceEndpoint('EcrDockerEndpoint', {
  service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,   // ECR Docker layer pulls
  privateDnsEnabled: true,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
});

this.vpc.addInterfaceEndpoint('SecretsManagerEndpoint', {
  service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
  privateDnsEnabled: true,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
});

this.vpc.addInterfaceEndpoint('CloudWatchLogsEndpoint', {
  service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
  privateDnsEnabled: true,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
});
```

**Endpoint cost awareness:**
- Gateway endpoint (S3): **free** — no hourly charge, only data processing ($0.01/GB)
- Interface endpoints: **~$7.20/month each per AZ × 2 AZs** = ~$14.40/mo each, × 4 = ~$57.60/mo total

**References:**
- [`aws-cdk-lib/aws-ec2.Vpc`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.Vpc.html)
- [`aws-cdk-lib/aws-ec2.InterfaceVpcEndpoint`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.InterfaceVpcEndpoint.html)
- [`aws-cdk-lib/aws-ec2.GatewayVpcEndpoint`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.GatewayVpcEndpoint.html)
- [`InterfaceVpcEndpointAwsService` enum](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.InterfaceVpcEndpointAwsService.html)

---

## 3. EcsStack

**File:** `lib/ecs-stack.ts`

**Imports:**
```typescript
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
```

**Stack props interface:**
```typescript
export interface EcsStackProps extends cdk.StackProps {
  readonly vpc: ec2.Vpc;
}
```

### 3.1 ECS Cluster + ASG Capacity Provider

```typescript
export class EcsStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly taskRole: iam.Role;
  public readonly executionRole: iam.Role;
  public readonly daemonSecurityGroup: ec2.SecurityGroup;
  public readonly secretsKey: kms.Key;
  public readonly repository: ecr.Repository;
  public readonly logGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props: EcsStackProps) {
    super(scope, id, props);
    const { vpc } = props;

    // --- Cluster ---
    this.cluster = new ecs.Cluster(this, 'DaemonCluster', {
      vpc,
      clusterName: 'controlai-daemons',
    });

    // --- Auto Scaling Group for EC2 instances ---
    const asg = new autoscaling.AutoScalingGroup(this, 'DaemonAsg', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
      minCapacity: 1,
      maxCapacity: 10,
      // Distribute across private subnets
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      // Allow EC2 to be terminated by the capacity provider
      newInstancesProtectedFromScaleIn: false,
      // Associate the ASG with the ECS cluster via user data
      userData: cdk.Fn.base64(''), // EcsOptimizedImage handles this
    });

    // -- Capacity Provider ---
    const capacityProvider = new ecs.AsgCapacityProvider(this, 'DaemonCapacityProvider', {
      autoScalingGroup: asg,
      // Managed scaling: ECS manages the ASG desired count
      enableManagedScaling: true,
      targetCapacityPercent: 80,
      minimumScalingStepSize: 1,
      maximumScalingStepSize: 2,
      instanceWarmupPeriod: cdk.Duration.seconds(120),
    });
    this.cluster.addAsgCapacityProvider(capacityProvider);
    // ...
```

**About `EcsOptimizedImage.amazonLinux2()`:** This is the CDK convenience method that resolves to the latest ECS-optimized Amazon Linux 2 AMI for the target region/architecture. Equivalent to querying the SSM parameter `/aws/service/ecs/optimized-ami/amazon-linux-2/recommended`.

### 3.2 IAM Roles

```typescript
    // --- Task Role (what the daemon process assumes) ---
    this.taskRole = new iam.Role(this, 'DaemonTaskRole', {
      roleName: 'controlai-daemon-task-role',
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'IAM role assumed by daemon containers',
    });
    // Initially empty; per-daemon inline policies added by the provisioner
    // or via task definition taskRoleArn references.

    // --- Execution Role (what ECS agent uses to pull images, secrets, logs) ---
    this.secretsKey = new kms.Key(this, 'DaemonSecretsKey', {
      alias: 'alias/controlai-daemon-secrets',
      description: 'KMS key for encrypting daemon secrets in Secrets Manager',
      enableKeyRotation: true,
    });

    this.executionRole = new iam.Role(this, 'DaemonExecutionRole', {
      roleName: 'controlai-daemon-execution-role',
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'IAM role for ECS agent to pull images, fetch secrets, ship logs',
    });

    // Managed policy: AmazonECSTaskExecutionRolePolicy
    this.executionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonECSTaskExecutionRolePolicy'),
    );

    // Inline policy: secretsmanager:GetSecretValue on daemon secrets
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [
        `arn:aws:secretsmanager:*:*:secret:controlai/daemon/*`,
      ],
    }));

    // Inline policy: kms:Decrypt on the daemon KMS key
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      actions: ['kms:Decrypt'],
      resources: [this.secretsKey.keyArn],
    }));
```

**Execution role scope notes:**
- `AmazonECSTaskExecutionRolePolicy` grants ECR pull (`GetAuthorizationToken`, `BatchGetImage`, etc.), CloudWatch Logs `CreateLogStream`/`PutLogEvents`, and SSM/Secrets Manager access — but only for the `secrets` array in the task definition.
- The inline `secretsmanager:GetSecretValue` scopes it to the `controlai/daemon/*` path prefix.
- The `kms:Decrypt` on the specific key ensures secrets encrypted with this key can be decrypted by the ECS agent.

### 3.3 ECR Repository

```typescript
    this.repository = new ecr.Repository(this, 'DaemonRepository', {
      repositoryName: 'controlai-daemon',
      removalPolicy: cdk.RemovalPolicy.RETAIN,  // Don't delete on `cdk destroy`
      lifecycleRules: [
        { maxImageCount: 10, rulePriority: 1 },
      ],
    });
```

### 3.4 CloudWatch Log Group

```typescript
    this.logGroup = new logs.LogGroup(this, 'DaemonLogGroup', {
      logGroupName: '/aws/ecs/controlai-daemons',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // OK to delete on stack teardown
    });
```

### 3.5 Security Group

```typescript
    this.daemonSecurityGroup = new ec2.SecurityGroup(this, 'DaemonSecurityGroup', {
      vpc,
      securityGroupName: 'controlai-daemon-tasks',
      description: 'Security group for daemon ECS tasks',
      allowAllOutbound: false,  // We'll add specific egress rules
    });

    // Egress: HTTPS (443) for webhook calls
    this.daemonSecurityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS outbound',
    );

    // Egress: MQTT over TLS (8883) and MQTT (1883) for broker connectivity
    this.daemonSecurityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(8883),
      'Allow MQTT over TLS outbound',
    );
    this.daemonSecurityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(1883),
      'Allow MQTT outbound',
    );

    // Ingress: left restricted — Caddy SG ingress rule added in IngressStack
```

### 3.6 SSM Parameter Outputs

```typescript
    new ssm.StringParameter(this, 'EcsClusterNameParam', {
      parameterName: '/controlai/infra/ECS_CLUSTER_NAME',
      stringValue: this.cluster.clusterName,
    });
    new ssm.StringParameter(this, 'EcsTaskRoleArnParam', {
      parameterName: '/controlai/infra/ECS_TASK_ROLE_ARN',
      stringValue: this.taskRole.roleArn,
    });
    new ssm.StringParameter(this, 'EcsExecutionRoleArnParam', {
      parameterName: '/controlai/infra/ECS_EXECUTION_ROLE_ARN',
      stringValue: this.executionRole.roleArn,
    });
    new ssm.StringParameter(this, 'EcsSecurityGroupIdParam', {
      parameterName: '/controlai/infra/ECS_SECURITY_GROUP_ID',
      stringValue: this.daemonSecurityGroup.securityGroupId,
    });
    // Subnet IDs as CSV (for the provisioner to split)
    new ssm.StringParameter(this, 'EcsSubnetsParam', {
      parameterName: '/controlai/infra/ECS_SUBNETS',
      stringValue: cdk.Fn.join(',', vpc.privateSubnets.map(s => s.subnetId)),
    });
    new ssm.StringParameter(this, 'SecretsKmsKeyArnParam', {
      parameterName: '/controlai/infra/SECRETS_KMS_KEY_ARN',
      stringValue: this.secretsKey.keyArn,
    });
    new ssm.StringParameter(this, 'DaemonLogGroupParam', {
      parameterName: '/controlai/infra/DAEMON_LOG_GROUP',
      stringValue: this.logGroup.logGroupName,
    });
  }
}
```

**References:**
- [`aws-cdk-lib/aws-ecs.Cluster`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs.Cluster.html)
- [`aws-cdk-lib/aws-ecs.AsgCapacityProvider`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs.AsgCapacityProvider.html)
- [`aws-cdk-lib/aws-ecs.EcsOptimizedImage`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs.EcsOptimizedImage.html)
- [`aws-cdk-lib/aws-autoscaling.AutoScalingGroup`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_autoscaling.AutoScalingGroup.html)
- [`aws-cdk-lib/aws-iam.Role`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_iam.Role.html)
- [`aws-cdk-lib/aws-kms.Key`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_kms.Key.html)
- [`aws-cdk-lib/aws-ecr.Repository`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecr.Repository.html)
- [`aws-cdk-lib/aws-logs.LogGroup`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_logs.LogGroup.html)
- [`aws-cdk-lib/aws-ssm.StringParameter`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ssm.StringParameter.html)

---

## 4. DnsStack

**File:** `lib/dns-stack.ts`

**Imports:**
```typescript
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
```

**Stack props interface:**
```typescript
export interface DnsStackProps extends cdk.StackProps {
  // No cross-stack inputs
}
```

```typescript
export class DnsStack extends cdk.Stack {
  public readonly hostedZone: route53.HostedZone;
  public readonly certificate: acm.Certificate;

  constructor(scope: Construct, id: string, props: DnsStackProps) {
    super(scope, id, props);

    // --- Route53 Hosted Zone ---
    this.hostedZone = new route53.HostedZone(this, 'DaemonHostedZone', {
      zoneName: 'daemons.controlai.io',
      comment: 'Public hosted zone for daemon customer subdomains',
    });

    // --- Wildcard ACM Certificate ---
    this.certificate = new acm.Certificate(this, 'WildcardCert', {
      domainName: '*.daemons.controlai.io',
      validation: acm.CertificateValidation.fromDns(this.hostedZone),
    });

    // --- SSM outputs ---
    new ssm.StringParameter(this, 'HostedZoneIdParam', {
      parameterName: '/controlai/infra/HOSTED_ZONE_ID',
      stringValue: this.hostedZone.hostedZoneId,
    });
    new ssm.StringParameter(this, 'HostedZoneNameParam', {
      parameterName: '/controlai/infra/HOSTED_ZONE_NAME',
      stringValue: this.hostedZone.zoneName,
    });
    new ssm.StringParameter(this, 'CertArnParam', {
      parameterName: '/controlai/infra/CERTIFICATE_ARN',
      stringValue: this.certificate.certificateArn,
    });
  }
}
```

**DNS delegation note:** After the first `cdk deploy`, the operator must extract the NS records from the newly created `daemons.controlai.io` hosted zone and add them as NS records in the parent zone (`controlai.io`). Until that is done, DNS resolution for `*.daemons.controlai.io` will not work.

**Region awareness for ACM:** ACM certificates must be in `us-east-1` for use with CloudFront, but **this certificate is for an ALB in `ap-northeast-2`**, so it is created in the same region as the stack. The CDK `Certificate` construct creates the cert in the stack's region (`ap-northeast-2`). Only CloudFront requires `us-east-1` certificates.

**References:**
- [`aws-cdk-lib/aws-route53.HostedZone`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_route53.HostedZone.html)
- [`aws-cdk-lib/aws-certificatemanager.Certificate`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_certificatemanager.Certificate.html)
- [`aws-cdk-lib/aws-certificatemanager.CertificateValidation`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_certificatemanager.CertificateValidation.html)

---

## 5. IngressStack

**File:** `lib/ingress-stack.ts`

**Imports:**
```typescript
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as logs from 'aws-cdk-lib/aws-logs';
```

**Stack props interface:**
```typescript
export interface IngressStackProps extends cdk.StackProps {
  readonly vpc: ec2.Vpc;
  readonly certificate: acm.Certificate;
  readonly hostedZone: route53.HostedZone;
  readonly cluster: ecs.Cluster;           // From EcsStack — for the Caddy Fargate service
}
```

### 5.1 ALB with HTTPS + HTTP redirect

```typescript
export class IngressStack extends cdk.Stack {
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly caddyAdminEndpoint: string;

  constructor(scope: Construct, id: string, props: IngressStackProps) {
    super(scope, id, props);
    const { vpc, certificate, hostedZone, cluster } = props;

    // --- ALB (internet-facing) ---
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'DaemonAlb', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      internetFacing: true,
      loadBalancerName: 'controlai-daemon-alb',
    });

    // HTTPS listener (port 443) with wildcard cert
    const httpsListener = this.alb.addListener('HttpsListener', {
      port: 443,
      certificates: [certificate],
      // Default action: forward to Caddy (set up after Caddy TG is created)
    });

    // HTTP listener (port 80) → redirect to HTTPS
    this.alb.addListener('HttpListener', {
      port: 80,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol: 'HTTPS',
        port: '443',
        permanent: true,  // 301
      }),
    });
    // ...
```

**Redirect action breakdown:**
```typescript
// The redirect action props shape:
elbv2.ListenerAction.redirect({
  protocol: 'HTTPS',        // Protocol to redirect to
  port: '443',              // Port to redirect to
  host: '#{host}',          // Preserve the original host header (default)
  path: '/#{path}',         // Preserve the original path (default)
  query: '#{query}',        // Preserve the original query string (default)
  permanent: true,          // Use 301 (true) vs 302 (false)
})
```

### 5.2 Caddy Fargate Service + Target Group

```typescript
    // --- Security Group for Caddy ---
    // Allow ingress from ALB on Caddy's port (80)
    const caddySecurityGroup = new ec2.SecurityGroup(this, 'CaddySecurityGroup', {
      vpc,
      securityGroupName: 'controlai-caddy-sg',
      description: 'Security group for Caddy reverse proxy',
    });
    // Ingress from ALB (the ALB's security group is auto-created)
    caddySecurityGroup.connections.allowFrom(
      this.alb,                          // ALB SG reference
      ec2.Port.tcp(80),
      'Allow traffic from ALB',
    );

    // --- Allow Caddy SG → daemon SG ingress (for daemon health checks) ---
    // This imports the daemon SG from the EcsStack via SSM parameter
    // (since we don't have direct object access from the EcsStack)
    // Actually — better: pass daemonSG as a prop. But if not, use fromLookupById:

    // --- Fargate Service for Caddy ---
    const taskDef = new ecs.FargateTaskDefinition(this, 'CaddyTaskDef', {
      cpu: 512,        // 0.5 vCPU
      memoryLimitMiB: 1024,
    });

    const caddyContainer = taskDef.addContainer('Caddy', {
      // Use a custom Caddy image with the route53 DNS-01 plugin
      image: ecs.ContainerImage.fromRegistry('caddy:2-builder'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'caddy',
        logGroup: new logs.LogGroup(this, 'CaddyLogGroup', {
          logGroupName: '/aws/ecs/controlai-caddy',
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      }),
    });
    caddyContainer.addPortMappings({
      containerPort: 80,     // HTTP proxy traffic
    });
    caddyContainer.addPortMappings({
      containerPort: 2019,   // Admin API (internal)
    });

    // --- Target Group for Caddy ---
    const caddyTargetGroup = new elbv2.ApplicationTargetGroup(this, 'CaddyTargetGroup', {
      vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/health',
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
      },
    });

    // Create the Fargate service attached to the target group
    const caddyService = new ecs.FargateService(this, 'CaddyService', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 2,
      securityGroups: [caddySecurityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
    });
    caddyService.attachToApplicationTargetGroup(caddyTargetGroup);

    // Now set the HTTPS listener's default action → Caddy TG
    httpsListener.addAction('DefaultAction', {
      action: elbv2.ListenerAction.forward([caddyTargetGroup]),
    });
```

**Caddy image build note:** The `caddy:2-builder` image is the straight Docker Hub image. For the Route53 DNS-01 plugin, you'll need a custom image:

```dockerfile
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/route53

FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
```

Build and push to ECR, then replace `ContainerImage.fromRegistry` with `ContainerImage.fromEcrRepository(...)`.

### 5.3 Route53 A Record (ALB alias)

```typescript
    new route53.ARecord(this, 'WildcardAliasRecord', {
      zone: hostedZone,
      recordName: '*.daemons.controlai.io',
      target: route53.RecordTarget.fromAlias(
        new route53Targets.LoadBalancerTarget(this.alb),
      ),
    });
```

### 5.4 Cloud Map Private DNS Namespace

```typescript
    const namespace = new servicediscovery.PrivateDnsNamespace(this, 'DaemonNamespace', {
      name: 'daemons.local',
      vpc,
      description: 'Cloud Map namespace for daemon SRV records',
    });

    // --- SSM outputs ---
    this.caddyAdminEndpoint = `http://${caddyService.serviceName}:2019`;

    new ssm.StringParameter(this, 'AlbDnsNameParam', {
      parameterName: '/controlai/infra/ALB_DNS_NAME',
      stringValue: this.alb.loadBalancerDnsName,
    });
    new ssm.StringParameter(this, 'AlbArnParam', {
      parameterName: '/controlai/infra/ALB_ARN',
      stringValue: this.alb.loadBalancerFullName,
    });
    new ssm.StringParameter(this, 'CaddyAdminEndpointParam', {
      parameterName: '/controlai/infra/CADDY_ADMIN_ENDPOINT',
      stringValue: this.caddyAdminEndpoint,
    });
    new ssm.StringParameter(this, 'CloudMapNamespaceIdParam', {
      parameterName: '/controlai/infra/CLOUD_MAP_NAMESPACE_ID',
      stringValue: namespace.namespaceId,
    });
  }
}
```

**Cloud Map SRV record registration** is done at daemon provisioning time (by the provisioner's SDK code, not CDK). It calls:

```typescript
await servicediscovery.registerInstance({
  ServiceId: serviceId,
  InstanceId: taskArn,
  Attributes: {
    AWS_INSTANCE_IPV4: privateIp,
    AWS_INSTANCE_PORT: String(dynamicPort),
    // SRV record type
    AWS_INSTANCE_CNAME: hostname,
  },
});
```

**References:**
- [`aws-cdk-lib/aws-elasticloadbalancingv2.ApplicationLoadBalancer`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_elasticloadbalancingv2.ApplicationLoadBalancer.html)
- [`aws-cdk-lib/aws-elasticloadbalancingv2.ApplicationListener`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_elasticloadbalancingv2.ApplicationListener.html)
- [`aws-cdk-lib/aws-elasticloadbalancingv2.ListenerAction.redirect`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_elasticloadbalancingv2.ListenerAction.html#static-redirectredirprops)
- [`aws-cdk-lib/aws-route53-targets.LoadBalancerTarget`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_route53_targets.LoadBalancerTarget.html)
- [`aws-cdk-lib/aws-servicediscovery.PrivateDnsNamespace`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_servicediscovery.PrivateDnsNamespace.html)
- [`aws-cdk-lib/aws-servicediscovery.Service`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_servicediscovery.Service.html)
- [`aws-cdk-lib/aws-ecs.FargateService`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs.FargateService.html)

---

## 6. MonitoringStack

**File:** `lib/monitoring-stack.ts`

**Imports:**
```typescript
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ssm from 'aws-cdk-lib/aws-ssm';
```

**Stack props interface:**
```typescript
export interface MonitoringStackProps extends cdk.StackProps {
  readonly cluster: ecs.Cluster;
  readonly alb: elbv2.ApplicationLoadBalancer;
}
```

```typescript
export class MonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);
    const { cluster, alb } = props;

    // --- SNS Topic ---
    const topic = new sns.Topic(this, 'DaemonAlertsTopic', {
      topicName: 'controlai-daemons-alerts',
      displayName: 'ControlAI Daemon Fleet Alerts',
    });

    // --- Alarm: Cluster CPU > 80% ---
    new cloudwatch.Alarm(this, 'ClusterCpuAlarm', {
      metric: cluster.metricCpuUtilization(),
      threshold: 80,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      period: cdk.Duration.minutes(5),
      alarmName: 'controlai-daemon-cluster-cpu >80%',
      alarmDescription: 'ECS cluster CPU utilization exceeds 80%',
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    }).addAlarmAction(new cloudwatchActions.SnsAction(topic));

    // --- Alarm: Cluster Memory > 80% ---
    new cloudwatch.Alarm(this, 'ClusterMemoryAlarm', {
      metric: cluster.metricMemoryUtilization(),
      threshold: 80,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      period: cdk.Duration.minutes(5),
      alarmName: 'controlai-daemon-cluster-memory >80%',
      alarmDescription: 'ECS cluster memory utilization exceeds 80%',
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    }).addAlarmAction(new cloudwatchActions.SnsAction(topic));

    // --- Alarm: ALB 5xx > 10 in 5 min ---
    new cloudwatch.Alarm(this, 'Alb5xxAlarm', {
      metric: alb.metrics.httpCodeElb(
        elbv2.HttpCodeElb.ELB_5XX_COUNT,
        { statistic: 'Sum', period: cdk.Duration.minutes(1) },
      ),
      threshold: 10,
      evaluationPeriods: 5,
      datapointsToAlarm: 5,
      alarmName: 'controlai-daemon-alb-5xx >10',
      alarmDescription: 'ALB returned 10+ 5xx errors in 5 consecutive minutes',
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    }).addAlarmAction(new cloudwatchActions.SnsAction(topic));

    // --- SSM output ---
    new ssm.StringParameter(this, 'SnsTopicArnParam', {
      parameterName: '/controlai/infra/SNS_ALERT_TOPIC_ARN',
      stringValue: topic.topicArn,
    });
  }
}
```

**Available ECS cluster metrics (via L2 methods):**
- `cluster.metricCpuUtilization()` — average CPU over the cluster
- `cluster.metricMemoryUtilization()` — average memory over the cluster
- `cluster.metric('CPUReservation')` — raw metric name

**Available ALB metrics (via L2 methods):**
- `alb.metrics.httpCodeElb(code)` — ELB-generated HTTP codes
- `alb.metrics.httpCodeTarget(code)` — target-generated HTTP codes
- `alb.metrics.activeConnectionCount()`
- `alb.metrics.newConnectionCount()`
- `alb.metrics.requestCount()`
- `alb.metrics.targetResponseTime()`

**References:**
- [`aws-cdk-lib/aws-cloudwatch.Alarm`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudwatch.Alarm.html)
- [`aws-cdk-lib/aws-sns.Topic`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_sns.Topic.html)
- [`aws-cdk-lib/aws-cloudwatch-actions.SnsAction`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudwatch_actions.SnsAction.html)
- [`ecs.Cluster.metricCpuUtilization`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs.Cluster.html#metriccpuutilizationprops)
- [`elbv2.ApplicationLoadBalancer.metrics`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_elasticloadbalancingv2.ApplicationLoadBalancer.html#metricsmetricnameprops)

---

## 7. Cross-Stack Reference Patterns

### 7.1 Constructor Props (preferred approach)

The CDK v2 recommended pattern: pass constructs directly via stack constructor props. This avoids the need for `Fn.import_value` / `CrossRegionReference`.

```typescript
// bin/cdk.ts
const network = new NetworkStack(app, 'controlai-network', { env });
const dns = new DnsStack(app, 'controlai-dns', { env });
const ecs = new EcsStack(app, 'controlai-ecs', {
  env,
  vpc: network.vpc,
});
const ingress = new IngressStack(app, 'controlai-ingress', {
  env,
  vpc: network.vpc,
  certificate: dns.certificate,
  hostedZone: dns.hostedZone,
  cluster: ecs.cluster,
});
new MonitoringStack(app, 'controlai-monitoring', {
  env,
  cluster: ecs.cluster,
  alb: ingress.alb,
});
```

**How CDK resolves this:** When one stack references a construct from another stack, CDK automatically generates CloudFormation `Fn::ImportValue` / `Fn::GetAtt` cross-stack references and adds `DependsOn` clauses. At deploy time, stacks are deployed in dependency order.

### 7.2 SSM Parameter Store (runtime reference pattern)

For values consumed by the provisioner's runtime (SDK code), write SSM parameters:

```typescript
new ssm.StringParameter(this, 'EcsClusterNameParam', {
  parameterName: '/controlai/infra/ECS_CLUSTER_NAME',
  stringValue: cluster.clusterName,
});
```

**Full SSM parameter inventory:**

| Parameter Name | Source Stack | Value |
|---|---|---|
| `/controlai/infra/ECS_CLUSTER_NAME` | EcsStack | `cluster.clusterName` |
| `/controlai/infra/ECS_TASK_ROLE_ARN` | EcsStack | `taskRole.roleArn` |
| `/controlai/infra/ECS_EXECUTION_ROLE_ARN` | EcsStack | `executionRole.roleArn` |
| `/controlai/infra/ECS_SECURITY_GROUP_ID` | EcsStack | `daemonSecurityGroup.securityGroupId` |
| `/controlai/infra/ECS_SUBNETS` | EcsStack | `Fn.join(',', vpc.privateSubnets.map(s => s.subnetId))` |
| `/controlai/infra/SECRETS_KMS_KEY_ARN` | EcsStack | `secretsKey.keyArn` |
| `/controlai/infra/DAEMON_LOG_GROUP` | EcsStack | `logGroup.logGroupName` |
| `/controlai/infra/HOSTED_ZONE_ID` | DnsStack | `hostedZone.hostedZoneId` |
| `/controlai/infra/HOSTED_ZONE_NAME` | DnsStack | `hostedZone.zoneName` |
| `/controlai/infra/CERTIFICATE_ARN` | DnsStack | `certificate.certificateArn` |
| `/controlai/infra/ALB_DNS_NAME` | IngressStack | `alb.loadBalancerDnsName` |
| `/controlai/infra/ALB_ARN` | IngressStack | `alb.loadBalancerFullName` |
| `/controlai/infra/CADDY_ADMIN_ENDPOINT` | IngressStack | `http://<service>:2019` |
| `/controlai/infra/CLOUD_MAP_NAMESPACE_ID` | IngressStack | `namespace.namespaceId` |
| `/controlai/infra/SNS_ALERT_TOPIC_ARN` | MonitoringStack | `topic.topicArn` |

---

## 8. CDK Synth in CI

```bash
cd packages/infra

# Requires --quiet to suppress asset-hash noise
npx cdk synth --quiet

# Or via pnpm
pnpm synth
```

**No AWS credentials needed for `cdk synth`** — it only performs template synthesis. AWS credentials are only needed for `cdk deploy` or `cdk diff` (which calls CloudFormation).

**CI smoke test pattern:**
```yaml
# In CI pipeline (e.g., GitHub Actions)
- name: CDK Synth
  working-directory: packages/infra
  run: npx cdk synth --quiet
  # No AWS creds required
```

---

## 9. Region Pinning

All stacks use the same `env` object to pin to `ap-northeast-2`:

```typescript
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: 'ap-northeast-2',
};
```

**Why `CDK_DEFAULT_ACCOUNT`:** This resolves at synthesis time from the AWS CLI profile or environment variables (`AWS_ACCOUNT_ID`, `AWS_DEFAULT_REGION`). Using the explicit region string pins the region while letting the account resolve from the caller's context.

**Why not hardcode the account:** When different developers or CI environments deploy to different accounts (dev sandbox vs prod), hardcoding the account would require manual updates. `CDK_DEFAULT_ACCOUNT` resolves from whatever profile is used.

---

## 10. Deployment Order

```bash
# 1. Bootstrap (one-time per account/region)
cdk bootstrap aws://<account>/ap-northeast-2

# 2. Deploy bottom-up
cdk deploy controlai-network-dev
cdk deploy controlai-dns-dev       # ← extract NS records, delegate parent zone
cdk deploy controlai-ecs-dev
cdk deploy controlai-ingress-dev
cdk deploy controlai-monitoring-dev

# Or deploy all at once (CDK sorts dependencies)
cdk deploy --all --require-approval never
```

After deploying `controlai-dns-dev`, the operator must extract NS records from the newly created `daemons.controlai.io` hosted zone and add them as NS records in the parent zone (`controlai.io`) at the DNS registrar. Until delegation is complete, `*.daemons.controlai.io` will not resolve.

---

## 11. Common Pitfalls

### a) `AsgCapacityProvider` requires a user data script

`EcsOptimizedImage.amazonLinux2()` handles the ECS agent bootstrap, but the ASG user data must tell the ECS agent which cluster to join. In CDK v2, using `cluster.addAsgCapacityProvider(capacityProvider)` with the ASG attached to the cluster should handle this automatically via the cluster's ASG lifecycle hook mechanism. If tasks never register, check that the ECS agent on the instance can reach the ECS API endpoint (hence the VPC Interface Endpoint).

### b) `InterfaceVpcEndpoint` costing

Each interface endpoint costs ~$7.20/region/month per AZ. With 2 AZs × 4 endpoints = 8 endpoints = ~$57.60/month before any data processing charges. This is a fixed cost even when the cluster is idle.

### c) `Fn.join` with CDK tokens

```typescript
// CORRECT — using Fn.join with token array
stringValue: cdk.Fn.join(',', vpc.privateSubnets.map(s => s.subnetId)),

// WRONG — joining at synth time gives literal "undefined" for unresolved tokens
stringValue: vpc.privateSubnets.map(s => s.subnetId).join(','), // ❌ tokens not resolved yet
```

CDK tokens (like `subnetId`) are placeholders that resolve during CloudFormation deployment. Using a plain `.join(',')` at synthesis time won't work because the tokens are opaque objects, not strings. Always use `Fn.join` when concatenating token values.

### d) Security group cross-stack references

If `IngressStack` needs to allow traffic from Caddy's SG to the daemon SG (created in `EcsStack`), you have two options:

**Option 1: Pass the daemon SG as a constructor prop** (recommended):
```typescript
// EcsStack exports it
this.daemonSecurityGroup = daemonSG;

// IngressStack receives it
const ingress = new IngressStack(app, ..., { daemonSecurityGroup: ecs.daemonSecurityGroup });
```

**Option 2: Import via SSM parameter** (for runtime-only contexts):
```typescript
const daemonSgId = ssm.StringParameter.valueForStringParameter(this, '/controlai/infra/ECS_SECURITY_GROUP_ID');
const daemonSG = ec2.SecurityGroup.fromSecurityGroupId(this, 'ImportedDaemonSG', daemonSgId);
```

### e) Caddy health check path

The Caddy container must serve a `/health` endpoint that returns 200. Caddy doesn't have a built-in health endpoint — you need to configure it in the Caddyfile:

```caddyfile
*.daemons.controlai.io {
    // ... proxy config ...

    handle /health {
        respond "OK" 200
    }
}
```

Or, simpler for initial deploy: set the ALB health check target to `protocol: HTTP, path: /`. Caddy will respond with 404 (which counts as unhealthy if you set `healthyHttpCodes: '200'`). Either add a Caddyfile handler or use a more permissive health check.

---

## 12. Quick Reference: Construct Imports

| AWS Service | CDK Import Path | Key Constructs |
|---|---|---|
| EC2 / VPC | `aws-cdk-lib/aws-ec2` | `Vpc`, `SecurityGroup`, `InterfaceVpcEndpoint`, `InstanceType`, `SubnetType`, `Peer`, `Port` |
| ECS | `aws-cdk-lib/aws-ecs` | `Cluster`, `AsgCapacityProvider`, `FargateService`, `FargateTaskDefinition`, `EcsOptimizedImage`, `ContainerImage`, `LogDrivers` |
| Auto Scaling | `aws-cdk-lib/aws-autoscaling` | `AutoScalingGroup` |
| IAM | `aws-cdk-lib/aws-iam` | `Role`, `ServicePrincipal`, `PolicyStatement`, `ManagedPolicy` |
| KMS | `aws-cdk-lib/aws-kms` | `Key` |
| ECR | `aws-cdk-lib/aws-ecr` | `Repository` |
| CloudWatch Logs | `aws-cdk-lib/aws-logs` | `LogGroup`, `RetentionDays` |
| Route53 | `aws-cdk-lib/aws-route53` | `HostedZone`, `ARecord`, `RecordTarget` |
| Route53 Targets | `aws-cdk-lib/aws-route53-targets` | `LoadBalancerTarget` |
| ACM | `aws-cdk-lib/aws-certificatemanager` | `Certificate`, `CertificateValidation` |
| ELBv2 | `aws-cdk-lib/aws-elasticloadbalancingv2` | `ApplicationLoadBalancer`, `ApplicationTargetGroup`, `ApplicationProtocol`, `TargetType`, `HttpCodeElb` |
| Service Discovery | `aws-cdk-lib/aws-servicediscovery` | `PrivateDnsNamespace`, `Service` |
| CloudWatch | `aws-cdk-lib/aws-cloudwatch` | `Alarm`, `ComparisonOperator` |
| CloudWatch Actions | `aws-cdk-lib/aws-cloudwatch-actions` | `SnsAction` |
| SNS | `aws-cdk-lib/aws-sns` | `Topic` |
| SSM | `aws-cdk-lib/aws-ssm` | `StringParameter` |
| Core | `aws-cdk-lib` | `Stack`, `App`, `Fn`, `Duration`, `Tags`, `RemovalPolicy` |
| Constructs | `constructs` | `Construct` |

---

## 13. CDK v2 API Reference URLs

| Construct | Reference URL |
|---|---|
| Vpc | https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.Vpc.html |
| InterfaceVpcEndpoint | https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.InterfaceVpcEndpoint.html |
| GatewayVpcEndpoint | https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.GatewayVpcEndpoint.html |
| Cluster | https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs.Cluster.html |
| AsgCapacityProvider | https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs.AsgCapacityProvider.html |
| EcsOptimizedImage | https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs.EcsOptimizedImage.html |
| AutoScalingGroup | https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_autoscaling.AutoScalingGroup.html |
| ApplicationLoadBalancer | https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_elasticloadbalancingv2.ApplicationLoadBalancer.html |
| ApplicationTargetGroup | https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_elasticloadbalancingv2.ApplicationTargetGroup.html |
| ListenerAction.redirect | https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_elasticloadbalancingv2.ListenerAction.html#static-redirectredirprops |
| HostedZone | https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_route53.HostedZone.html |
| Certificate | https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_certificatemanager.Certificate.html |
| PrivateDnsNamespace | https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_servicediscovery.PrivateDnsNamespace.html |
| LoadBalancerTarget | https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_route53_targets.LoadBalancerTarget.html |
| Alarm | https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudwatch.Alarm.html |
| SnsAction | https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudwatch_actions.SnsAction.html |
| StringParameter | https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ssm.StringParameter.html |
| Fn | https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.Fn.html |
| Duration | https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.Duration.html |

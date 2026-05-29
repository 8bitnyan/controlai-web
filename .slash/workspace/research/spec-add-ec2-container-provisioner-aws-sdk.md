# AWS SDK v3 Reference — ECS-on-EC2 Provisioner + Secrets Manager + Mocking

**Date**: 2026-05-28  
**Audience**: TypeScript coder implementing `Ec2ContainerProvisioner`  
**Scope**: Runtime SDK calls (provisioner + tests). No CDK.

---

## 1. @aws-sdk/client-ecs — Full Command Reference

### Install

```bash
npm install @aws-sdk/client-ecs
```

### Imports

```ts
import { ECSClient } from "@aws-sdk/client-ecs";
import { RegisterTaskDefinitionCommand } from "@aws-sdk/client-ecs";
import { CreateServiceCommand } from "@aws-sdk/client-ecs";
import { DescribeTasksCommand } from "@aws-sdk/client-ecs";
import { ListTasksCommand } from "@aws-sdk/client-ecs";
import { UpdateServiceCommand } from "@aws-sdk/client-ecs";
import { DeleteServiceCommand } from "@aws-sdk/client-ecs";
import { StopTaskCommand } from "@aws-sdk/client-ecs";
import { DeregisterTaskDefinitionCommand } from "@aws-sdk/client-ecs";
import { TagResourceCommand } from "@aws-sdk/client-ecs";
import { DescribeContainerInstancesCommand } from "@aws-sdk/client-ecs";
```

One-liner alternative (same tree-shake result):

```ts
import {
  ECSClient,
  RegisterTaskDefinitionCommand,
  CreateServiceCommand,
  DescribeTasksCommand,
  ListTasksCommand,
  UpdateServiceCommand,
  DeleteServiceCommand,
  StopTaskCommand,
  DeregisterTaskDefinitionCommand,
  TagResourceCommand,
  DescribeContainerInstancesCommand,
} from "@aws-sdk/client-ecs";
```

### Client init

```ts
const ecs = new ECSClient({ region: "ap-northeast-2" });
```

### RegisterTaskDefinition

**Input**:

```ts
import type { RegisterTaskDefinitionCommandInput } from "@aws-sdk/client-ecs";

const input: RegisterTaskDefinitionCommandInput = {
  family: "my-service",
  networkMode: "bridge",               // REQUIRED for EC2 host-port mapping
  requiresCompatibilities: ["EC2"],
  cpu: "512",
  memory: "1024",
  taskRoleArn: "arn:aws:iam::123456789012:role/my-task-role",
  executionRoleArn: "arn:aws:iam::123456789012:role/my-exec-role",
  containerDefinitions: [
    {
      name: "app",
      image: "123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/my-app:latest",
      essential: true,
      cpu: 512,
      memory: 1024,
      portMappings: [
        { containerPort: 8080, hostPort: 0, protocol: "tcp" },  // hostPort:0 = random ephemeral
      ],
      secrets: [
        {
          name: "DAEMON_BEARER_TOKEN",
          valueFrom: "arn:aws:secretsmanager:ap-northeast-2:123456789012:secret:my-secret-abc123",
        },
      ],
      logConfiguration: {
        logDriver: "awslogs",
        options: {
          "awslogs-group": "/ecs/my-service",
          "awslogs-region": "ap-northeast-2",
          "awslogs-stream-prefix": "ecs",
        },
      },
    },
  ],
  tags: [{ key: "Environment", value: "production" }],
};
```

**Call**:

```ts
const cmd = new RegisterTaskDefinitionCommand(input);
const res = await ecs.send(cmd);
```

**Response key fields**:

```ts
res.taskDefinition?.taskDefinitionArn;      // "arn:aws:ecs:...:task-definition/my-service:1"
res.taskDefinition?.revision;               // 1
res.taskDefinition?.status;                 // "ACTIVE"
```

**Docs**: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/ecs/command/RegisterTaskDefinitionCommand/

---

### CreateService (EC2 + capacity provider + binpack)

**Input**:

```ts
import type { CreateServiceCommandInput } from "@aws-sdk/client-ecs";

const input: CreateServiceCommandInput = {
  cluster: "my-cluster",
  serviceName: "my-service",
  taskDefinition: "my-service:1",          // family:revision or full ARN
  desiredCount: 1,
  capacityProviderStrategy: [
    {
      capacityProvider: "my-capacity-provider",
      weight: 1,
      base: 1,
    },
  ],
  placementStrategy: [
    { type: "binpack", field: "memory" },  // binpack on memory
  ],
  propagateTags: "TASK_DEFINITION",
  tags: [{ key: "Environment", value: "production" }],
  // networkConfiguration is NOT needed for bridge-mode EC2
};
```

**Call**:

```ts
const cmd = new CreateServiceCommand(input);
const res = await ecs.send(cmd);
```

**Response key fields**:

```ts
res.service?.serviceArn;          // "arn:aws:ecs:...:service/my-cluster/my-service"
res.service?.status;              // "ACTIVE"
res.service?.desiredCount;        // 1
res.service?.runningCount;        // 0 (initially)
```

**Docs**: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/ecs/command/CreateServiceCommand/

---

### DescribeTasks — polling for RUNNING

**Input**:

```ts
const input = {
  cluster: "my-cluster",
  tasks: ["arn:aws:ecs:ap-northeast-2:123456789012:task/my-cluster/abc123"],
};
```

**Polling loop**:

```ts
export async function waitForTaskRunning(
  ecs: ECSClient,
  cluster: string,
  taskArn: string,
  budgetMs = 120_000,
): Promise<TaskRunningResult> {
  const deadline = Date.now() + budgetMs;

  while (Date.now() < deadline) {
    const res = await ecs.send(new DescribeTasksCommand({ cluster, tasks: [taskArn] }));
    const task = res.tasks?.[0];
    if (!task) throw new Error(`Task ${taskArn} not found`);

    const lastStatus = task.lastStatus;       // string
    const health = task.healthStatus;         // "HEALTHY" | "UNHEALTHY" | "UNKNOWN"

    if (lastStatus === "RUNNING") {
      return { task, lastStatus, health };
    }
    if (lastStatus === "STOPPED") {
      throw new Error(`Task stopped: ${task.stoppedReason}`);
    }

    await sleep(1000);
  }

  throw new Error(`Timeout waiting for task ${taskArn} to reach RUNNING`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
```

**Response key fields**:

```ts
task.taskArn;                                   // string
task.lastStatus;                                // "RUNNING" | "STOPPED" | "PENDING" | ...
task.desiredStatus;                             // "RUNNING" | "STOPPED"
task.healthStatus;                              // "HEALTHY" | "UNHEALTHY" | "UNKNOWN"
task.stoppedReason;                             // string (only when STOPPED)
task.containers[0].networkBindings[0].hostPort; // number (assigned host port)
task.containers[0].networkBindings[0].bindIP;   // "0.0.0.0"
task.containerInstanceArn;                      // needed to resolve EC2 private IP
```

**Docs**: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/ecs/command/DescribeTasksCommand/

---

### Resolving EC2 private IP from containerInstanceArn

Two-step: DescribeContainerInstances → DescribeInstances.

```ts
import { DescribeInstancesCommand } from "@aws-sdk/client-ec2";
import { EC2Client } from "@aws-sdk/client-ec2";
// npm install @aws-sdk/client-ec2

const ec2 = new EC2Client({ region: "ap-northeast-2" });

async function getEc2PrivateIp(
  ecs: ECSClient,
  ec2Client: EC2Client,
  cluster: string,
  containerInstanceArn: string,
): Promise<string | undefined> {
  // Step 1: get ec2InstanceId
  const ciRes = await ecs.send(
    new DescribeContainerInstancesCommand({
      cluster,
      containerInstances: [containerInstanceArn],
    }),
  );
  const ec2InstanceId = ciRes.containerInstances?.[0]?.ec2InstanceId;
  if (!ec2InstanceId) return undefined;

  // Step 2: get private IP
  const ec2Res = await ec2Client.send(
    new DescribeInstancesCommand({ InstanceIds: [ec2InstanceId] }),
  );
  return ec2Res.Reservations?.[0]?.Instances?.[0]?.PrivateIpAddress;
}
```

**DescribeContainerInstances input**: `{ cluster: string, containerInstances: string[] }`  
**Response key field**: `.containerInstances[0].ec2InstanceId` — the EC2 Instance ID (e.g. `i-0a1b2c3d4e5f`).

**Docs**:  
- https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/ecs/command/DescribeContainerInstancesCommand/  
- https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/ec2/command/DescribeInstancesCommand/

---

### ListTasks

```ts
const input = {
  cluster: "my-cluster",
  serviceName: "my-service",
  desiredStatus: "RUNNING",  // "RUNNING" | "STOPPED" | "PENDING"
};

const res = await ecs.send(new ListTasksCommand(input));
const taskArns: string[] = res.taskArns ?? [];  // ["arn:aws:ecs:...:task/my-cluster/abc123"]
```

**Docs**: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/ecs/command/ListTasksCommand/

---

### UpdateService

```ts
const input = {
  cluster: "my-cluster",
  service: "my-service",
  taskDefinition: "my-service:2",    // new revision
  desiredCount: 3,
  forceNewDeployment: true,          // force redeploy even if no diff
};

const res = await ecs.send(new UpdateServiceCommand(input));
// res.service?.taskDefinition (updated)
```

**Docs**: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/ecs/command/UpdateServiceCommand/

---

### DeleteService

```ts
const input = {
  cluster: "my-cluster",
  service: "my-service",
  force: true,  // deletes even if service has running tasks
};

await ecs.send(new DeleteServiceCommand(input));
```

**Docs**: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/ecs/command/DeleteServiceCommand/

---

### StopTask

```ts
const input = {
  cluster: "my-cluster",
  task: "arn:aws:ecs:...:task/my-cluster/abc123",
  reason: "Teardown by provisioner",
};

await ecs.send(new StopTaskCommand(input));
```

**Docs**: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/ecs/command/StopTaskCommand/

---

### DeregisterTaskDefinition

```ts
const input = {
  taskDefinition: "arn:aws:ecs:...:task-definition/my-service:1",
};

await ecs.send(new DeregisterTaskDefinitionCommand(input));
// Sets status to INACTIVE
```

**Docs**: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/ecs/command/DeregisterTaskDefinitionCommand/

---

### TagResource

```ts
const input = {
  resourceArn: "arn:aws:ecs:...:service/my-cluster/my-service",
  tags: [{ key: "ManagedBy", value: "provisioner" }],
};

await ecs.send(new TagResourceCommand(input));
```

**Docs**: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/ecs/command/TagResourceCommand/

---

## 2. Bridge-mode ECS Task Definition — Full JSON Shape

```json
{
  "family": "my-service",
  "networkMode": "bridge",
  "requiresCompatibilities": ["EC2"],
  "cpu": "512",
  "memory": "1024",
  "taskRoleArn": "arn:aws:iam::123456789012:role/my-task-role",
  "executionRoleArn": "arn:aws:iam::123456789012:role/my-exec-role",
  "containerDefinitions": [
    {
      "name": "app",
      "image": "123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/my-app:latest",
      "essential": true,
      "cpu": 512,
      "memory": 1024,
      "portMappings": [
        {
          "containerPort": 8080,
          "hostPort": 0,
          "protocol": "tcp"
        }
      ],
      "secrets": [
        {
          "name": "DAEMON_BEARER_TOKEN",
          "valueFrom": "arn:aws:secretsmanager:ap-northeast-2:123456789012:secret:my-secret-abc123"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/my-service",
          "awslogs-region": "ap-northeast-2",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ],
  "tags": [
    { "key": "Environment", "value": "production" }
  ]
}
```

**Key points**:
- `hostPort: 0` → ECS picks a free ephemeral port on the host (read via `networkBindings[0].hostPort` after task starts)
- `networkMode: "bridge"` → Docker bridge networking (required for `hostPort: 0` on EC2)
- `executionRoleArn` is needed for `awslogs` and `secrets` (ECS agent uses this to pull logs + secrets)
- `secrets[].valueFrom` is the full Secrets Manager ARN

---

## 3. CreateService with Capacity Provider + Binpack

```json
{
  "cluster": "my-cluster",
  "serviceName": "my-service",
  "taskDefinition": "my-service:1",
  "desiredCount": 1,
  "capacityProviderStrategy": [
    {
      "capacityProvider": "my-capacity-provider",
      "weight": 1,
      "base": 1
    }
  ],
  "placementStrategy": [
    {
      "type": "binpack",
      "field": "memory"
    }
  ],
  "propagateTags": "TASK_DEFINITION",
  "tags": [
    { "key": "Environment", "value": "production" }
  ]
}
```

**Key points**:
- `capacityProviderStrategy` replaces `launchType: "EC2"` when using capacity providers
- `placementStrategy: [{ type: "binpack", field: "memory" }]` packs tasks onto instances most efficiently for memory
- `propagateTags: "TASK_DEFINITION"` copies tags from the task def to the tasks
- No `networkConfiguration` needed for bridge-mode EC2

---

## 4. DescribeTasks Polling — Read Host IP + Port

**Pattern**: Poll every 1s until `lastStatus === "RUNNING"` or budget exhausted. After RUNNING, read:

```ts
const task = res.tasks![0];
const bindings = task.containers?.[0]?.networkBindings;
const hostPort = bindings?.[0]?.hostPort;        // number, e.g. 32768
const bindIp = bindings?.[0]?.bindIP;             // "0.0.0.0"
const ciArn  = task.containerInstanceArn;         // "arn:aws:ecs:...:container-instance/..."
```

Then resolve the EC2 private IP by calling `DescribeContainerInstances` → `DescribeInstances` (see §1 above).

The full dial address becomes: `{ec2-private-ip}:{hostPort}`.

---

## 5. Stopped-Task Error Inspection

When `lastStatus === "STOPPED"`, read the reason:

```ts
if (task.lastStatus === "STOPPED") {
  const reason = task.stoppedReason ?? "(no reason)";
  // e.g. "CannotPullContainerError: pull image ...: failed to resolve reference ..."
  // e.g. "ResourceInitializationError: unable to pull secrets..."
  // e.g. "Essential container in task exited"

  if (reason.includes("CannotPullContainerError")) {
    // handle image pull failure
  }
  throw new Error(`Task stopped: ${reason}`);
}
```

**Common `stoppedReason` substrings**:
- `"CannotPullContainerError"` — image pull failure (bad tag, ECR auth, network)
- `"ResourceInitializationError"` — secrets injection failure (bad KMS, missing execution role)
- `"Essential container in task exited"` — app crashed

---

## 6. @aws-sdk/client-secrets-manager

### Install

```bash
npm install @aws-sdk/client-secrets-manager
```

### Imports

```ts
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { CreateSecretCommand } from "@aws-sdk/client-secrets-manager";
import { UpdateSecretCommand } from "@aws-sdk/client-secrets-manager";
import { DeleteSecretCommand } from "@aws-sdk/client-secrets-manager";
import { DescribeSecretCommand } from "@aws-sdk/client-secrets-manager";
```

### Client init

```ts
const sm = new SecretsManagerClient({ region: "ap-northeast-2" });
```

### CreateSecret

```ts
import type { CreateSecretCommandInput } from "@aws-sdk/client-secrets-manager";

const input: CreateSecretCommandInput = {
  Name: "my-secret",
  SecretString: JSON.stringify({ token: "abc123" }),
  KmsKeyId: "alias/aws/secretsmanager",  // or a custom KMS key ARN
  Tags: [{ Key: "Environment", Value: "production" }],
};

try {
  const res = await sm.send(new CreateSecretCommand(input));
  res.ARN;  // "arn:aws:secretsmanager:..."
} catch (e) {
  if (e instanceof Error && e.name === "ResourceExistsException") {
    // Secret already exists — handle gracefully
  }
}
```

**Docs**: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/secrets-manager/command/CreateSecretCommand/

---

### UpdateSecret

```ts
const input = {
  SecretId: "arn:aws:secretsmanager:ap-northeast-2:123456789012:secret:my-secret-abc123",
  SecretString: JSON.stringify({ token: "new-token" }),
  KmsKeyId: "alias/aws/secretsmanager",
};

const res = await sm.send(new UpdateSecretCommand(input));
res.ARN;  // unchanged
res.VersionId;  // new version UUID
```

**Docs**: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/secrets-manager/command/UpdateSecretCommand/

---

### DeleteSecret

```ts
const input = {
  SecretId: "arn:aws:secretsmanager:ap-northeast-2:123456789012:secret:my-secret-abc123",
  ForceDeleteWithoutRecovery: true,  // skip recovery window
};

try {
  await sm.send(new DeleteSecretCommand(input));
} catch (e) {
  if (e instanceof Error && e.name === "ResourceNotFoundException") {
    // Already deleted — idempotent
  }
}
```

**Docs**: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/secrets-manager/command/DeleteSecretCommand/

---

### DescribeSecret

```ts
const input = { SecretId: "arn:aws:secretsmanager:...:secret:my-secret-abc123" };
const res = await sm.send(new DescribeSecretCommand(input));
res.Name;           // "my-secret"
res.ARN;            // full ARN
res.LastAccessedDate;
res.DeletedDate;    // set if scheduled for deletion
res.KmsKeyId;       // KMS key ARN or alias
```

**Docs**: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/secrets-manager/command/DescribeSecretCommand/

---

### Error handling pattern (all Secrets Manager commands)

```ts
import { ResourceExistsException } from "@aws-sdk/client-secrets-manager"; // v3.722+ has named exceptions
// For older SDK: use e.name === 'ResourceExistsException'

try {
  await sm.send(new CreateSecretCommand({ Name: "x", SecretString: "y" }));
} catch (e) {
  if (e instanceof Error) {
    switch (e.name) {
      case "ResourceExistsException":
        // idempotent: already exists, ok
        break;
      case "InvalidParameterException":
        // bad input
        break;
      case "EncryptionFailure":
        // KMS issue
        break;
      default:
        throw e;
    }
  }
}
```

---

## 7. @aws-sdk/client-service-discovery (Cloud Map)

### Install

```bash
npm install @aws-sdk/client-servicediscovery
```

### Imports

```ts
import { ServiceDiscoveryClient } from "@aws-sdk/client-servicediscovery";
import { RegisterInstanceCommand } from "@aws-sdk/client-servicediscovery";
import { DeregisterInstanceCommand } from "@aws-sdk/client-servicediscovery";
```

### Client init

```ts
const sd = new ServiceDiscoveryClient({ region: "ap-northeast-2" });
```

### RegisterInstance

```ts
import type { RegisterInstanceCommandInput } from "@aws-sdk/client-servicediscovery";

const input: RegisterInstanceCommandInput = {
  ServiceId: "srv-abc123",          // NOT the namespace ID — this is the Cloud Map Service ID
  InstanceId: "my-service-v1-001",  // unique per instance
  Attributes: {
    AWS_INSTANCE_IPV4: "10.0.1.50", // EC2 private IP
    AWS_INSTANCE_PORT: "32768",     // host port as string
  },
};

const res = await sd.send(new RegisterInstanceCommand(input));
res.OperationId;  // used to track DNS propagation
```

**Response**: `{ OperationId: "string" }`

**Note**: The Cloud Map Service must be pre-created (e.g. via CDK). Pass its ID via env var (`SERVICE_DISCOVERY_SERVICE_ID`).

**Docs**: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/servicediscovery/command/RegisterInstanceCommand/

---

### DeregisterInstance

```ts
const input = {
  ServiceId: "srv-abc123",
  InstanceId: "my-service-v1-001",
};

const res = await sd.send(new DeregisterInstanceCommand(input));
res.OperationId;
```

**Docs**: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/servicediscovery/command/DeregisterInstanceCommand/

---

## 8. AWS SDK v3 Error name Detection

All AWS SDK v3 errors expose `name` as the exception class name:

```ts
try {
  await ecs.send(new CreateServiceCommand({ ... }));
} catch (e) {
  if (e instanceof Error) {
    console.log(e.name);     // "ClusterNotFoundException", "InvalidParameterException", etc.
    console.log(e.message);  // human-readable
    console.log((e as any).$metadata?.requestId);  // AWS request ID (if available)
  }
}
```

**Common ECS error names**:
- `ClusterNotFoundException`
- `InvalidParameterException`
- `ClientException`
- `ServerException`
- `ServiceNotFoundException`
- `TaskDefinitionNotFoundException`
- `ResourceNotFoundException`

**Common Secrets Manager error names**:
- `ResourceExistsException` — use on `CreateSecret` for idempotency
- `ResourceNotFoundException` — use on `DeleteSecret` for idempotency
- `InvalidParameterException`
- `EncryptionFailure`
- `InternalServiceError`

**Common Service Discovery error names**:
- `ServiceNotFound`
- `InstanceNotFound`
- `InvalidInput`
- `RequestLimitExceeded`

> **Important**: AWS SDK v3 does NOT export distinct Error classes for every exception. Testing `e instanceof Error && e.name === 'XxxException'` is the portable pattern.

---

## 9. aws-sdk-client-mock v4 — Vitest Setup & Patterns

### Install

```bash
npm install --save-dev aws-sdk-client-mock
# Optional: Vitest matchers for call-count assertions
npm install --save-dev aws-sdk-client-mock-vitest
```

### Basic setup

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { ECSClient, CreateServiceCommand, DescribeTasksCommand } from "@aws-sdk/client-ecs";

const ecsMock = mockClient(ECSClient);

beforeEach(() => {
  ecsMock.reset();   // clear all behavior + call history
});
```

### .on().resolves() — single response

```ts
ecsMock
  .on(CreateServiceCommand)
  .resolves({
    service: {
      serviceArn: "arn:aws:ecs:ap-northeast-2:123456789012:service/my-cluster/my-service",
      serviceName: "my-service",
      status: "ACTIVE",
      desiredCount: 1,
      runningCount: 0,
    },
  });
```

### .on().rejects() — error simulation

```ts
ecsMock
  .on(DescribeTasksCommand)
  .rejects(new Error("CannotPullContainerError: pull access denied"));
```

### Chained .resolvesOnce() — sequential polling responses

```ts
ecsMock
  .on(DescribeTasksCommand)
  .resolvesOnce({
    tasks: [{ taskArn: "arn:...", lastStatus: "PENDING", containers: [{ networkBindings: [] }] }],
  })
  .resolvesOnce({
    tasks: [{ taskArn: "arn:...", lastStatus: "RUNNING", containers: [{ networkBindings: [{ hostPort: 32768 }] }] }],
  });
```

### .on().callsFake() — dynamic response based on input

```ts
ecsMock
  .on(DescribeTasksCommand)
  .callsFake((input) => {
    if (input.tasks?.[0]?.includes("abc")) {
      return { tasks: [{ lastStatus: "RUNNING" }] };
    }
    return { tasks: [{ lastStatus: "PENDING" }] };
  });
```

### Asserting call count

```ts
import "aws-sdk-client-mock-vitest"; // adds custom matchers

// With aws-sdk-client-mock-vitest:
expect(ecsMock).toHaveReceivedCommand(CreateServiceCommand);
expect(ecsMock).toHaveReceivedCommandTimes(CreateServiceCommand, 1);

// Without vitest matchers — use commandCalls():
const calls = ecsMock.commandCalls(CreateServiceCommand);
expect(calls).toHaveLength(1);
expect(calls[0].args[0].input).toMatchObject({
  serviceName: "my-service",
  desiredCount: 1,
});
```

### Mocking multiple clients in one test

```ts
const ecsMock = mockClient(ECSClient);
const smMock = mockClient(SecretsManagerClient);
const sdMock = mockClient(ServiceDiscoveryClient);
const ec2Mock = mockClient(EC2Client);

beforeEach(() => {
  ecsMock.reset();
  smMock.reset();
  sdMock.reset();
  ec2Mock.reset();
});
```

### Mocking global `fetch` for Caddy API calls

```ts
import { vi } from "vitest";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Assert specific fetch calls:
expect(fetch).toHaveBeenCalledWith(
  expect.stringContaining("/config/apps/http/servers/srv0/routes"),
  expect.objectContaining({ method: "POST" }),
);
```

### Type-safe constructor injection with mockClient

If your class takes `ECSClient` in its constructor, the mock returned by `mockClient(ECSClient)` is NOT assignable directly to the `ECSClient` type (see [issue #223](https://github.com/m-radzikowski/aws-sdk-client-mock/issues/223)). Workaround:

```ts
const ecsMock = mockClient(ECSClient) as unknown as ECSClient;
// or cast in the constructor call:
const provisioner = new Ec2ContainerProvisioner(
  ecsMock as unknown as ECSClient,
  smMock as unknown as SecretsManagerClient,
);
```

---

## 10. Caddy Admin API — Route Management

**Base URL**: `http://localhost:2019`

### Add a reverse-proxy route (POST)

```http
POST /config/apps/http/servers/srv0/routes
Content-Type: application/json
```

```json
{
  "@id": "route-my-service",
  "match": [{ "host": ["my-service.example.com"] }],
  "handle": [
    {
      "handler": "reverse_proxy",
      "upstreams": [{ "dial": "10.0.1.50:32768" }]
    }
  ]
}
```

> `POST` **appends** to the routes array. `PATCH /config/.../routes/0` would **replace** an element.

### Remove a route (DELETE by @id)

```http
DELETE /id/route-my-service
```

### Remove a route by index (DELETE)

```http
DELETE /config/apps/http/servers/srv0/routes/0
```

### Caddy route JSON structure

```json
{
  "@id": "optional-unique-id",
  "match": [
    { "host": ["<hostname>"] }
  ],
  "handle": [
    {
      "handler": "reverse_proxy",
      "upstreams": [
        { "dial": "<host>:<port>" }
      ]
    }
  ]
}
```

**Docs**: https://caddyserver.com/docs/api-tutorial (full tutorial)  
**Reverse proxy handler**: https://caddyserver.com/docs/json/apps/http/servers/routes/handle/reverse_proxy/

---

## Quick Package Install Summary

```bash
npm install @aws-sdk/client-ecs
npm install @aws-sdk/client-secrets-manager
npm install @aws-sdk/client-servicediscovery
npm install @aws-sdk/client-ec2           # only needed for DescribeInstances (private IP lookup)

npm install --save-dev aws-sdk-client-mock
npm install --save-dev aws-sdk-client-mock-vitest   # optional vitest matchers
```

## Quick Import Summary (all clients)

```ts
import { ECSClient, RegisterTaskDefinitionCommand, CreateServiceCommand, DescribeTasksCommand,
  ListTasksCommand, UpdateServiceCommand, DeleteServiceCommand, StopTaskCommand,
  DeregisterTaskDefinitionCommand, TagResourceCommand, DescribeContainerInstancesCommand } from "@aws-sdk/client-ecs";
import { SecretsManagerClient, CreateSecretCommand, UpdateSecretCommand,
  DeleteSecretCommand, DescribeSecretCommand } from "@aws-sdk/client-secrets-manager";
import { ServiceDiscoveryClient, RegisterInstanceCommand, DeregisterInstanceCommand } from "@aws-sdk/client-servicediscovery";
import { EC2Client, DescribeInstancesCommand } from "@aws-sdk/client-ec2";
```

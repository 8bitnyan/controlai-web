# Research: Multi-Process Container Supervision on ECS-on-EC2 (2026)

**Date**: 2026-05-29

**Context**: Single-container image running Node.js daemon + MQTT-like broker + ingest worker + TimescaleDB, supervised on AWS ECS (EC2 launch type).

---

## Table of Contents

1. [s6-overlay v3 Deep Dive](#1-s6-overlay-v3-deep-dive)
2. [supervisord Compared](#2-supervisord-compared)
3. [ECS-on-EC2 Task Lifecycle & Multi-Process Health Checks](#3-ecs-on-ec2-task-lifecycle--multi-process-health-checks)
4. [Persistent State on ECS-on-EC2](#4-persistent-state-on-ecs-on-ec2)
5. [TimescaleDB Containerization](#5-timescaledb-containerization)
6. [Signal Forwarding Chain: PID 1 → Supervisor → Children](#6-signal-forwarding-chain-pid-1--supervisor--children)
7. [Production Dockerfile Examples](#7-production-dockerfile-examples)
8. [Opinionated Recommendation](#8-opinionated-recommendation)

---

## 1. s6-overlay v3 Deep Dive

### 1.1 What It Is

s6-overlay is a set of scripts and tarballs that install the [s6](https://skarnet.org/software/s6/overview.html) supervision suite as PID 1 inside a container. It is maintained by Laurent Bercot (skarnet.org) and the just-containers GitHub org. It is **the** recommended init system for multi-process Docker images by LinuxServer.io, Paperless-ngx, Twenty CRM, PhotoPrism, and hundreds of other production projects.

> **Evidence** ([s6-overlay README](https://github.com/just-containers/s6-overlay/blob/master/README.md)):
> "s6-overlay is an easy-to-install (just extract a tarball or two!) set of scripts and utilities allowing you to use existing Docker images while using s6 as a pid 1 for your container and process supervisor for your services."

### 1.2 Service Types: Oneshot vs Longrun

s6-overlay v3 uses [s6-rc](https://skarnet.org/software/s6-rc/overview.html) as its service manager. Two service types:

| Type | Behavior | Use Case |
|------|----------|----------|
| **oneshot** | Runs once, exits. Has `up` and `down` scripts. | DB migration, config generation, init scripts |
| **longrun** | Long-lived daemon supervised by s6. Restarts on failure unless a `finish` script halts the container. | Node.js server, PostgreSQL, Mosquitto MQTT, ingest worker |

> **Evidence** ([s6-overlay README - Writing a service script](https://github.com/just-containers/s6-overlay/blob/master/README.md#writing-a-service-script)):
> "The advantage of this new format is that it allows you to define dependencies between services: if B depends on A, then A will start first, then B will start when A is ready, and when the container is told to exit, B will stop first, then A."

### 1.3 Dependency Ordering

Services declare dependencies via empty files in `dependencies.d/`. All user services should depend on `base` (the built-in bundle) to avoid race conditions. Services in `user2` bundle can additionally depend on `legacy-services` to start after all `/etc/services.d` services.

**Start order** (stage 2):
1. `/etc/cont-init.d` scripts (legacy oneshots, sequential)
2. s6-rc `user` bundle services (ordered by dependency graph)
3. `/etc/services.d` legacy longruns
4. s6-rc `user2` bundle services (requires explicit `legacy-services` dependency)

**Stop order** (stage 3, reverse):
1. user2 services stop
2. `/etc/services.d` longruns get SIGTERM
3. s6-rc services stop (reverse dependency order)
4. `/etc/cont-finish.d` scripts run
5. All remaining processes get SIGTERM → grace period → SIGKILL

> **Evidence** ([s6-overlay README - Init stages](https://github.com/just-containers/s6-overlay/blob/master/README.md#init-stages)):
> "When the container is stopped [...] the operations are performed in the reverse order [...] Send a TERM signal to all legacy longrun services [...] Bring down user s6-rc services in an orderly fashion [...] Send all remaining processes a TERM signal [...] Sleep for a small grace time [...] Send all processes a KILL signal."

**For the proposed pipeline**, the dependency graph should be:

```
base
 └─ timescaledb-init (oneshot: create data dirs, set perms)
     └─ timescaledb (longrun: PostgreSQL/TimescaleDB)
         └─ mosquitto-mqtt (longrun: MQTT broker) [depends on TimescaleDB being ready]
         └─ ingest-worker (longrun: consumes from MQTT, writes to TimescaleDB)
             └─ node-daemon (longrun: HTTP API, reads TimescaleDB)
```

> **Evidence** ([s6-overlay issue #631 - dependency ordering](https://github.com/just-containers/s6-overlay/issues/631)):
> "If you want service B to start after service A, then you must declare that B depends on A. This is true for all your services."

### 1.4 Per-Service Logging

s6-overlay provides a first-class logging pipeline via `logutil-service` (a wrapper over `s6-log`). Every longrun can have a dedicated logger service that:

- Captures stdout/stderr
- Rotates logs automatically (default: 20 files of 1 MB each)
- Drops privileges to `nobody`
- Can tee to container stdout for CloudWatch/docker logs

**Legacy `/etc/services.d` logger example**:

```
/etc/services.d/myapp/run
/etc/services.d/myapp/log/run   → exec logutil-service /var/log/myapp
```

**s6-rc pipeline logger example** (more idiomatic in v3):

```
/etc/s6-overlay/s6-rc.d/myapp/            (longrun, producer for myapp-log)
/etc/s6-overlay/s6-rc.d/myapp-log/        (longrun, consumer for myapp)
/etc/s6-overlay/s6-rc.d/myapp-log-prepare/ (oneshot, creates log dir)
```

> **Evidence** ([s6-overlay README - Logging](https://github.com/just-containers/s6-overlay/blob/master/README.md#logging)):
> "s6-overlay provides a utility called logutil-service which is a wrapper over the s6-log program. This helper does the following: read how s6-log should proceed [...] drop privileges to the nobody user [...] clean all the environments variables [...] execute into s6-log."

**For the pipeline**: Each of the 4 processes can have its own logger writing rotated files. Meanwhile, container stdout (via CloudWatch) can capture a combined stream by setting `S6_LOGGING=0` (the default, which sends everything to stdout/stderr) or by having loggers `tee` output to container stdout via the `1` directive in the `s6-log` script.

### 1.5 Graceful Shutdown on SIGTERM (ECS Context)

When ECS sends `docker stop`, the Docker daemon sends SIGTERM to PID 1. In s6-overlay, PID 1 is `s6-svscan`. The shutdown sequence is:

1. s6-svscan receives SIGTERM → triggers stage 3
2. All supervised services get SIGTERM in reverse dependency order
3. s6 waits `S6_SERVICES_GRACETIME` (default 3000ms) for services to die
4. `/etc/cont-finish.d` scripts run
5. All remaining processes get SIGTERM
6. After `S6_KILL_GRACETIME` (default 3000ms), SIGKILL
7. Container exits

**ECS interaction**: ECS sends SIGTERM → waits `stopTimeout` (default 30s, configurable up to 120s) → sends SIGKILL. The s6 sequence fits comfortably within 30s. For PostgreSQL, you need to ensure the `finish` script gives Postgres time to flush WAL. Set `S6_SERVICES_GRACETIME` and `S6_KILL_GRACETIME` generously:

```dockerfile
ENV S6_SERVICES_GRACETIME=15000
ENV S6_KILL_GRACETIME=10000
```

This gives 15s for services to shut down, 10s final kill grace = 25s total, well within ECS's 30s default.

> **Evidence** ([s6-overlay README - Customizing behaviour](https://github.com/just-containers/s6-overlay/blob/master/README.md#customizing-s6-overlay-behaviour)):
> "S6_SERVICES_GRACETIME (default = 3000): How long (in milliseconds) s6 should wait, at shutdown time, for services declared in /etc/services.d to die before proceeding with the rest of the shutdown."
> 
> "S6_KILL_GRACETIME (default = 3000): How long (in milliseconds) s6 should wait, at the end of the shutdown procedure when all the processes have received a TERM signal, for them to die before sending a KILL signal."

### 1.6 Exit-on-Failure-of-Critical-Service

Unlike supervisord (which treats all failures as restartable), s6-overlay can be configured so that a critical service failure brings down the whole container. This is essential for ECS, where the orchestrator should see a failed container and replace it.

- **Run the critical service as CMD**: If the CMD exits, the container exits immediately with that exit code. ECS sees the task stop and replaces it.
- **Use a `finish` script with `/run/s6/basedir/bin/halt`**: For supervised longruns, the `finish` script can write the exit code and call halt.

**Example finish script that propagates exit code**:

```sh
#!/bin/sh
if test "$1" -eq 256 ; then
  e=$((128 + $2))
else
  e="$1"
fi
echo "$e" > /run/s6-linux-init-container-results/exitcode
exec /run/s6/basedir/bin/halt
```

> **Evidence** ([s6-overlay README - Setting the exit code](https://github.com/just-containers/s6-overlay/blob/master/README.md#setting-the-exit-code-of-the-container-to-the-exit-code-of-your-main-service)):
> "If you run your main service as a supervised service [...] you need to tell the container what code to exit with when you send it a docker stop command."

### 1.7 Recommended Dockerfile Layering

**Pattern** (from paperless-ngx, twentyhq, linuxserver.io):

```dockerfile
# Stage 1: s6-overlay installation
FROM base AS s6-layer
ARG S6_OVERLAY_VERSION=3.2.2.0
ARG TARGETARCH

# Download and verify
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz /tmp
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-${S6_ARCH}.tar.xz /tmp
RUN tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz \
 && tar -C / -Jxpf /tmp/s6-overlay-${S6_ARCH}.tar.xz \
 && rm /tmp/s6-overlay-*.tar.xz

ENV S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0 \
    S6_VERBOSITY=1

# Stage 2: Application
FROM s6-layer AS final
COPY ./s6-services/ /etc/s6-overlay/s6-rc.d/
RUN mkdir -p /etc/s6-overlay/s6-rc.d/user/contents.d \
 && touch /etc/s6-overlay/s6-rc.d/user/contents.d/timescaledb \
 && touch /etc/s6-overlay/s6-rc.d/user/contents.d/mosquitto \
 && touch /etc/s6-overlay/s6-rc.d/user/contents.d/ingest-worker \
 && touch /etc/s6-overlay/s6-rc.d/user/contents.d/node-daemon

ENTRYPOINT ["/init"]
```

> **Evidence** - Paperless-ngx Dockerfile ([paperless-ngx/paperless-ngx Dockerfile at dev](https://github.com/paperless-ngx/paperless-ngx/blob/dev/Dockerfile)):
> Uses multi-stage build, installs s6-overlay 3.2.2.0, sets `S6_BEHAVIOUR_IF_STAGE2_FAILS=2`, copies service defs from `./docker/rootfs/`.

> **Evidence** - Twenty CRM Dockerfile ([twentyhq/twenty Dockerfile](https://github.com/twentyhq/twenty/blob/main/packages/twenty-docker/twenty/Dockerfile), lines 201-258):
> Builds an "all-in-one" `twenty-app-dev` target with PostgreSQL, Redis, and the Node.js server all supervised under s6-overlay. `ENTRYPOINT ["/init"]`. Includes the `S6_KEEP_ENV=1` pattern for environment passthrough.

---

## 2. supervisord Compared

### 2.1 What supervisord Does Well

supervisord is a battle-tested process control system written in Python. It uses INI-style config files. For single-server daemon management, it works.

### 2.2 Why Most Modern Guides Recommend s6-overlay Instead

| Dimension | supervisord | s6-overlay |
|-----------|------------|------------|
| **PID 1 behavior** | Not designed as PID 1. The [supervisord docs](http://supervisord.org/) explicitly state: "Supervisor is not designed to run as a substitute for init." | Designed as PID 1 from the ground up. Handles signal forwarding, zombie reaping, proper shutdown stages. |
| **Runtime dependency** | Requires Python (~30 MB image overhead) | Static binaries (~5.7 MB), no runtime language dependency |
| **Signal handling** | Sends same signal to all child processes. Cannot propagate real exit codes. | Per-service stop signals, configurable via `down-signal` file. Real exit code propagation via `finish` scripts. |
| **Exit-on-failure** | Default behavior is to restart failed processes indefinitely. Container never exits, so ECS never triggers replacement. | Can be configured to exit the container when a critical service fails (via `finish` + `halt`). |
| **Health check accuracy** | supervisord itself is healthy even when all children are dead → orchestrator thinks container is healthy | If critical services die via finish+halt, container exits → orchestrator sees UNHEALTHY/STOPPED |
| **Dependency ordering** | No first-class dependency graph. Relies on `priority=` numeric hints and startup race conditions. | Full directed-acyclic dependency graph via s6-rc. Declarative ordering. |
| **Logging** | Captures stdout per process but log rotation requires manual config | Built-in `s6-log` integration with automatic rotation, privilege separation, tee to stdout |
| **Configuration format** | INI file | Directory-based (one dir per service, files for type/run/finish/dependencies) |

> **Evidence** - Paperless-ngx PR #8886 ([paperless-ngx PR #8886](https://github.com/paperless-ngx/paperless-ngx/pull/8886)):
> "This PR transitions to Docker image away from supervisord to use s6. In the second paragraph of the supervisord documentation, it is noted to not be a proper replacement for PID 1. s6 is a proper PID 1 process supervision suite."

> **Evidence** - serversideup.net comparison ([Using S6 Overlay](https://serversideup.net/open-source/docker-php/docs/guide/using-s6-overlay)):
> "S6 Overlay was designed from the ground up to run within containers. [...] During a failure, Supervisor can be configured to restart the child process to attempt recovery, but the container orchestrator thinks the container is still healthy because supervisord is occupying PID 1 which is still healthy. [...] This design can lead to inaccurate container health statuses during a failure."

### 2.3 The "supervisord Never Exits" Problem for ECS

This is the single biggest reason to avoid supervisord on ECS:

```ini
[supervisord]
nodaemon=true

[program:node-daemon]
command=node server.js
autorestart=true   ; ← If node crashes, restarts forever

[program:timescaledb]
command=postgres
autorestart=true   ; ← If postgres crashes, restarts forever
```

With this config, if PostgreSQL crashes (data corruption, OOM), supervisord restarts it. The container stays RUNNING. ECS health check (via `curl localhost:3000/health`) might still pass because Node.js is still up. The task is never replaced. Data corruption goes unnoticed.

With s6-overlay, you can make TimescaleDB a `longrun` with a `finish` script that calls `halt`. If Postgres exits non-zero, the container stops, ECS replaces the task.

> **Evidence** - Kyle Cascade's init comparison ([Container Init Systems 2025](https://kyle.cascade.family/posts/a-comparison-of-container-init-systems-in-2025/)):
> "The 'application healthcheckers' — supervisord but also tools like monit or god. These focus on more 'application' than system process supervision. [...] nobody ever intended for these tools to monitor sshd."

---

## 3. ECS-on-EC2 Task Lifecycle & Multi-Process Health Checks

### 3.1 How ECS Health Check Works for a Single-Container Multi-Process Task

ECS task definitions have a `healthCheck` block that runs inside the container:

```json
{
  "containerDefinitions": [{
    "name": "pipeline",
    "image": "myorg/pipeline:latest",
    "essential": true,
    "healthCheck": {
      "command": ["CMD-SHELL", "curl -sf http://localhost:8080/health || exit 1"],
      "interval": 15,
      "timeout": 5,
      "retries": 3,
      "startPeriod": 60
    }
  }]
}
```

**Key facts**:
- The health check runs **inside** the container via the loopback interface
- Exit code 0 = healthy, non-zero = unhealthy
- An essential container that becomes UNHEALTHY causes the **entire task** to be replaced
- ALB health checks are independent (run from outside the container)
- ECS evaluates both: container health check + ALB health check

> **Evidence** ([AWS ECS health check docs](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/healthcheck.html)):
> "If the status of one essential container is UNHEALTHY, then the task status is UNHEALTHY."

> **Evidence** ([AWS Blog: Task Health and Replacement](https://aws.amazon.com/blogs/containers/a-deep-dive-into-amazon-ecs-task-health-and-task-replacement/)):
> "For a task to be healthy all containers that are marked as essential must be running."

### 3.2 Designing the Health Check for Multi-Process

Since all 4 processes live in one container, the health check needs to report overall pipeline health. Options:

**Option A: Lightweight — check the API process only**
```json
"command": ["CMD-SHELL", "curl -sf http://localhost:8080/health || exit 1"]
```
Assumes if the Node.js API is up, everything is probably up. Simple but can miss TimescaleDB failures.

**Option B: Comprehensive — check all processes**
```json
"command": ["CMD-SHELL", "curl -sf http://localhost:8080/health && pg_isready -h localhost && mosquitto_sub -t '$SYS/broker/uptime' -C 1 || exit 1"]
```
More accurate but risks cascading failures (e.g., MQTT being temporarily down triggers task replacement).

**Option C: Separate liveness and readiness**
- Container health check (liveness): `curl -sf http://localhost:8080/live` — just checks if the process is alive
- ALB health check (readiness): `curl -sf http://localhost:8080/ready` — checks dependencies

This is the recommended pattern. The container won't be killed by ECS for transient MQTT blips, but the ALB won't route traffic until all dependencies are ready.

> **Evidence** ([How to Configure ECS Health Checks - 2026](https://oneuptime.com/blog/post/2026-02-12-ecs-health-checks/view)):
> "Use the liveness check for the container health check (so ECS doesn't kill containers during database blips) and the readiness check for the ALB health check (so the ALB stops sending traffic to containers that can't serve requests)."

### 3.3 The 12-Factor "One Process Per Container" Objection

**The objection**: 12-factor app methodology says one process per container. Running Node.js + MQTT broker + ingest worker + TimescaleDB in one container violates this.

**The counter-argument for "tightly coupled stateful sidecars"**:

1. **Operational simplicity**: One task definition, one service, one CloudWatch log group, one port mapping. No coordination across 4 different task definitions.
2. **Data locality**: The ingest worker writes directly to the local TimescaleDB via Unix socket. Zero network overhead. This is critical for high-ingest workloads.
3. **Co-located lifecycle**: When the pipeline scales up/down, all components scale together. There's no risk of orphaned data producers pointing at a terminated database.
4. **Single-customer tenant model**: For multi-tenant SaaS where each customer gets an isolated pipeline, a single-container approach means one ECS task = one customer. Much simpler than orchestrating 4 containers per customer.
5. **s6-overlay mitigates the supervision gap**: The only valid objection was "no proper init" — s6-overlay solves that. With proper PID 1, signal forwarding, and exit-on-failure, the container behaves like a well-behaved 12-factor app from the outside.

> **Evidence** ([s6-overlay README - The Docker Way?](https://github.com/just-containers/s6-overlay/blob/master/README.md#the-docker-way)):
> "One of the oft-repeated Docker mantras is 'one process per container', but we disagree. There's nothing inherently bad about running multiple processes in a container. The more abstract 'one thing per container' is our policy — a container should do one thing, such as 'run a chat service' or 'run gitlab.' This may involve multiple processes, which is fine."

### 3.4 ECS Stop Timeout and Graceful Shutdown

ECS sends SIGTERM → waits for `stopTimeout` (30s default, configurable up to 120s in task definition) → sends SIGKILL.

For a multi-process container with TimescaleDB:
- PostgreSQL needs time to flush WAL and shut down checkpoints
- MQTT broker needs to persist session state
- Node.js needs to drain HTTP connections
- Ingest worker needs to commit in-flight messages

**Recommended configuration**:

```json
{
  "containerDefinitions": [{
    "stopTimeout": 90
  }]
}
```

And in the s6-overlay config:

```dockerfile
ENV S6_SERVICES_GRACETIME=30000
ENV S6_KILL_GRACETIME=15000
```

> **Evidence** ([AWS ECS task definition - stopTimeout](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html)):
> "The stopTimeout parameter specifies the number of seconds to wait for the container to exit after the SIGTERM signal is sent. The value range is 2-120 seconds."

---

## 4. Persistent State on ECS-on-EC2

### 4.1 Options

| Method | Durability | Performance | Complexity | Task Replacement |
|--------|-----------|-------------|-----------|------------------|
| Docker volume (local) | Lost on instance terminate | Native | Low | **Lost** |
| **Bind mount (host path)** | Survives within EC2 instance | Native | Low | **Survives if same instance** |
| **EFS (NFS)** | Cross-AZ durable | Lower latency | Medium | Survives any replacement |
| **EBS volume attach** (native ECS) | Cross-AZ via snapshot | High (gp3) | Medium | Snapshot+restore needed |
| EBS via task definition | Per-task persistent | High | Medium (IAM, infra role) | Service tasks: deleted; standalone: preserved |

### 4.2 ECS EBS Volume Attach (The New Shiny)

As of 2025-2026, ECS has native EBS volume attach support. Configured at launch time via `configuredAtLaunch: true`:

```json
{
  "volumes": [{
    "name": "timescaledb-data",
    "configuredAtLaunch": true
  }]
}
```

Then specified at `RunTask`/`CreateService`:

```json
{
  "volumeConfigurations": [{
    "name": "timescaledb-data",
    "sizeInGiB": 100,
    "volumeType": "gp3",
    "snapshotId": "snap-xxx"
  }]
}
```

**Key constraints**:
- One EBS volume per task
- Must be *new* volume (cannot attach existing)
- For service-managed tasks: volume is **deleted on task termination** — you must use snapshots and a Lambda lifecycle handler to preserve data
- For standalone tasks: you can set `deleteOnTermination: false`
- The `AmazonECSInfrastructureRolePolicyForVolumes` IAM policy is required

> **Evidence** ([AWS EBS volumes with ECS docs](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ebs-volumes.html)):
> "Volumes that are attached to tasks that are managed by a service aren't preserved and are always deleted upon task termination."

> **Evidence** ([AWS Storage Blog - EBS with Fargate](https://aws.amazon.com/blogs/storage/attaching-block-storage-with-aws-fargate-and-amazon-ebs-volumes/)):
> "When a task terminates, its attached EBS volume becomes orphaned — and the replacement task still needs access to that data. You can address this challenge by creating a snapshot of the orphaned volume and restoring it to a new volume for the replacement task."

### 4.3 Recommended Approach for TimescaleDB on ECS-on-EC2

**For production with the single-container pattern**:

| Layer | Storage | Rationale |
|-------|---------|-----------|
| TimescaleDB data | **EBS volume attach** via ECS (gp3, 100+ GiB) or **bind mount** an EBS volume pre-attached to the EC2 instance | WAL needs low-latency block storage; NFS/EFS is too slow for PostgreSQL |
| WAL | Same EBS volume (separate mount point) or second EBS with `gp3` high iops | WAL is sequential write-heavy; separate volume prevents I/O contention |
| MQTT persistence | EBS volume (same or separate) | Small data, but must survive restarts |
| Node.js local storage | EBS volume | File uploads/session cache |
| Backups | EBS snapshots via AWS Backup or pg_dump to S3 | Point-in-time recovery |

**Stateful task replacement workflow** (for EBS attach):

1. ECS task `STOPPING` → CloudWatch Event → Lambda triggered
2. Lambda creates EBS snapshot of the data volume
3. Lambda updates the service with new snapshot ID
4. Replacement task starts with volume restored from snapshot
5. TimescaleDB replays WAL on startup → consistent state

Alternatively, use **bind mounts to a pre-attached EBS volume** on the EC2 instance. This is simpler but ties the task to a specific instance, reducing flexibility. The ECS task placement constraint `instanceId` can pin tasks, but this sacrifices High Availability.

> **Evidence** ([AWS re:Post - Manage EBS volumes for ECS](https://repost.aws/knowledge-center/ecs-task-ebs-volume)):
> "To use data from an existing EBS volume, create a snapshot of the volume. Then, add the snapshot ID for SnapshotID under VolumeConfigurations."

---

## 5. TimescaleDB Containerization

### 5.1 Official Image

TimescaleDB provides official Docker images: `timescale/timescaledb:latest-pg17`. Based on the official PostgreSQL Docker image, with the TimescaleDB extension pre-installed.

**Usage**:

```bash
docker run -d --name timescaledb \
  -p 5432:5432 \
  -e POSTGRES_PASSWORD=password \
  -e TS_TUNE_MEMORY=4GB \
  -e TS_TUNE_NUM_CPUS=4 \
  -v timescaledb_data:/var/lib/postgresql/data \
  timescale/timescaledb:latest-pg17
```

> **Evidence** ([timescale/timescaledb-docker README](https://github.com/timescale/timescaledb-docker/blob/main/README.md)):
> "We run timescaledb-tune automatically on container initialization. [...] This image looks in the cgroups metadata to determine the docker-defined limit sizes then passes those values to timescaledb-tune."

### 5.2 Init Scripts

The official image uses the PostgreSQL Docker entrypoint, which runs scripts from `/docker-entrypoint-initdb.d/` on first initialization. Custom init SQL can be mounted:

```sql
-- init.sql
CREATE EXTENSION IF NOT EXISTS timescaledb;
SELECT create_hypertable('sensor_data', 'time', chunk_time_interval => INTERVAL '7 days');
```

Under s6-overlay supervision, these init scripts must be adapted. The TimescaleDB service `run` script would:

1. Check if `PGDATA` is initialized (check for `PG_VERSION`)
2. If not, run `initdb` with TimescaleDB options
3. Start PostgreSQL with `postgres -D $PGDATA`

### 5.3 WAL Persistence

PostgreSQL Write-Ahead Logs (WAL) are critical. Under containerization:

- WAL should live on the same EBS volume as `PGDATA` (default) or a dedicated high-IOPS volume
- `wal_level = replica` minimum for any production setup
- `archive_mode = on` with `archive_command` to push WAL to S3 (takes precedence over WAL-E sidecar approach which is deprecated)
- The official Wal-G/WAL-E integration works via HTTP sidecar

> **Evidence** ([Timescale docs - WAL-E sidecar](https://docs.timescale.com/self-hosted/latest/backup-and-restore/docker-and-wale)):
> "When you run TimescaleDB in a containerized environment, you can use continuous archiving with a WAL-E container. These containers are sometimes referred to as sidecars."

### 5.4 The "Do Not Run Postgres in a Container" Debate

**The objection**: Databases are stateful. Containers are ephemeral. Running PostgreSQL in a container means losing the operational benefits of a managed RDS — automated backups, Multi-AZ failover, read replicas, performance insights.

**Counter-arguments for single-customer managed-tier**:

1. **Single-tenant isolation**: When each customer gets their own pipeline (Node.js + MQTT + TimescaleDB in one container), running a managed RDS per customer is cost-prohibitive. One small RDS instance per tenant at $15/month × 1000 tenants = $15k/month just in DB overhead.
2. **Data gravity**: The ingest worker writes to TimescaleDB via Unix socket at microsecond latency. A network RDS adds 1-5ms per write — unacceptable for high-ingest IoT pipelines.
3. **Operational envelope**: "One tenant = one container = one Postgres" is a well-established pattern for SaaS platforms where each tenant's data must be cryptographically isolated. The container IS the blast radius.
4. **s6-overlay handles the supervision gap**: The main argument against containerized Postgres is "who makes sure Postgres stays up?" — s6-overlay answers this with proper supervision, health checks, and exit-on-failure.
5. **Snapshots replace RDS backups**: EBS snapshots + WAL archiving to S3 provide equivalent point-in-time recovery.

**When to say no**: If you need Multi-AZ HA (>99.99% uptime), cross-region replicas, or automated minor-version upgrades with zero downtime — use RDS. Containerized Postgres is for the "good enough" tier where cost and data locality matter more than five-nines.

> **Evidence** ([TimescaleDB on Kubernetes blog 2026](https://oneuptime.com/blog/post/2026-02-09-timescaledb-kubernetes-timeseries/view)):
> "Storage is the most critical aspect of running any database on Kubernetes. TimescaleDB needs fast, reliable storage for both data and WAL files. [...] Use SSD-backed persistent volumes."

---

## 6. Signal Forwarding Chain: PID 1 → Supervisor → Children

### 6.1 Why PID 1 Matters

In Linux, PID 1 has special properties:
1. It does not get default signal handlers — signals not explicitly handled are ignored
2. It is responsible for reaping orphaned zombie processes
3. When PID 1 exits, all other processes are killed

Many container runtimes (Java, Node, Python) do not handle these responsibilities correctly. Hence wrappers like `tini` and `dumb-init`.

### 6.2 tini's Role

`tini` is a minimal PID 1 wrapper that:
- Forwards signals to a single child process
- Reaps zombies
- Is the `--init` flag in `docker run`

**Limitation**: tini can only supervise **one** child process. It cannot run multiple processes or handle dependency ordering.

```bash
# tini's model: one child
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
```

> **Evidence** ([Kyle Cascade comparison](https://kyle.cascade.family/posts/a-comparison-of-container-init-systems-in-2025/)):
> | Tool | Supervision | Multi Process | Configuration |
> |------|-------------|---------------|---------------|
> | tini | ✗ | ✗ | CLI |
> | s6 | ✓ | ✓ | `/service` style dirs |
> | supervisord | ✓ | ✓ | INI Files |

### 6.3 s6-overlay Obviates tini

s6-overlay **includes and replaces tini**. The `s6-svscan` process runs as PID 1 and handles:
- Signal forwarding to all supervised services
- Zombie reaping
- Graceful shutdown ordering
- Per-service signal customization

When you set `ENTRYPOINT ["/init"]`, s6-overlay's `/init` starts `s6-svscan` as PID 1. You do **not** need and should **not** use `tini` or `--init` alongside s6-overlay.

**Important ECS caveat**: Disable `InitProcessEnabled` in ECS when using s6-overlay, because that would inject `tini` as PID 1, conflicting with s6-svscan.

> **Evidence** ([s6-overlay issue #535 - ECS Fargate](https://github.com/just-containers/s6-overlay/issues/535)):
> "For the ECS, I think i have found the issue. By disabling the init process, everything works as expected. InitProcessEnabled: Run an init process inside the container that forwards signals and reaps processes."

> **Evidence** ([s6-overlay README](https://github.com/just-containers/s6-overlay/blob/master/README.md)):
> "The s6-overlay provides proper PID 1 functionality. You'll never have zombie processes hanging around in your container, they will be properly cleaned up."

### 6.4 The Complete Chain

```
┌─────────────────────────────────────────────────────────┐
│  ECS Agent → Docker → SIGTERM → s6-svscan (PID 1)       │
│                                                         │
│  s6-svscan → stage 3:                                   │
│    ├── SIGTERM → s6-supervise → timescaledb              │
│    │       └── postgres flushes WAL, exits                │
│    ├── SIGTERM → s6-supervise → mosquitto                │
│    │       └── mosquitto persists sessions, exits         │
│    ├── SIGTERM → s6-supervise → ingest-worker             │
│    │       └── worker commits offset, exits               │
│    ├── SIGTERM → s6-supervise → node-daemon               │
│    │       └── Node drains connections, exits             │
│    │                                                      │
│    ├── cont-finish.d scripts run                          │
│    ├── GRACETIME wait (configurable)                      │
│    ├── SIGKILL to remaining processes                     │
│    └── Container exits with propagated exit code          │
└─────────────────────────────────────────────────────────┘
```

> **Evidence** ([s6-overlay issue #459 - signal forwarding](https://github.com/just-containers/s6-overlay/issues/459)):
> "When you send a signal to the container, the process that receives it is pid 1. In the case of s6-overlay, this process is s6-svscan, that controls the supervision tree [...] s6-overlay manages an environment with a whole tree of processes."

---

## 7. Production Dockerfile Examples

### 7.1 paperless-ngx (Migrated from supervisord to s6-overlay, Feb 2025)

**Repo**: https://github.com/paperless-ngx/paperless-ngx  
**PR**: [#8886 - Transition Docker to use s6 overlay](https://github.com/paperless-ngx/paperless-ngx/pull/8886)

This is the single best real-world example of the supervisord → s6-overlay migration pattern. The PR description says:

> "This PR transitions to Docker image away from supervisord to use s6. All the s6 services, oneshot or longrun can have dependencies defined between them, ensuring and enforcing a valid ordering of startup."

Key patterns:
- Multi-stage build with `s6-overlay-base` stage
- `S6_BEHAVIOUR_IF_STAGE2_FAILS=2` (stop container if init fails)
- `S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0` (wait forever for services)
- Service defs in `./docker/rootfs/etc/s6-overlay/s6-rc.d/`
- Includes a `user/contents.d` bundle for each service

```dockerfile
# From paperless-ngx Dockerfile (condensed):
FROM python:3.12-slim AS s6-overlay-base
ENV S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0 \
    S6_VERBOSITY=1
ARG S6_OVERLAY_VERSION=3.2.2.0
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz /tmp
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-x86_64.tar.xz /tmp
RUN tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz \
    && tar -C / -Jxpf /tmp/s6-overlay-x86_64.tar.xz
COPY ./docker/rootfs /
```

### 7.2 Twenty CRM (All-in-One Dev Image: Postgres + Redis + Node)

**Repo**: https://github.com/twentyhq/twenty  
**Dockerfile**: [packages/twenty-docker/twenty/Dockerfile](https://github.com/twentyhq/twenty/blob/main/packages/twenty-docker/twenty/Dockerfile) (lines 201-258)

This is the **most directly relevant** production example — an all-in-one image running PostgreSQL, Redis, and a Node.js server under s6-overlay. Exactly the pattern needed for the proposed pipeline.

```dockerfile
# Twenty CRM twenty-app-dev target (condensed from lines 201-258):
FROM alpine:3.20 AS s6-fetch
ARG S6_OVERLAY_VERSION=3.2.0.2
ARG TARGETARCH
RUN S6_ARCH=$(cat /tmp/s6arch) && \
    wget -O /tmp/s6-overlay-noarch.tar.xz \
      "https://github.com/.../s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz" && \
    wget -O /tmp/s6-overlay-arch.tar.xz \
      "https://github.com/.../s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-${S6_ARCH}.tar.xz"

FROM node:24-alpine AS twenty-app-dev
COPY --from=s6-fetch /tmp/s6-overlay-*.tar.xz /tmp/
RUN tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz \
    && tar -C / -Jxpf /tmp/s6-overlay-arch.tar.xz

# Install Postgres + Redis
RUN apk add --no-cache postgresql18 postgresql18-contrib redis

# s6 service definitions
COPY packages/twenty-docker/twenty-app-dev/rootfs/ /

RUN mkdir -p /data/postgres /data/redis \
    && chown -R postgres:postgres /data/postgres

ENV S6_KEEP_ENV=1
EXPOSE 2020
VOLUME ["/data/postgres"]
ENTRYPOINT ["/init"]
```

### 7.3 LinuxServer.io Base Images (Industry Standard)

**Repo**: https://github.com/linuxserver/docker-baseimage-alpine  
**Dockerfile**: [Dockerfile at master](https://github.com/linuxserver/docker-baseimage-alpine/blob/master/Dockerfile)

LinuxServer.io is the largest user of s6-overlay, with hundreds of production images. Their base images demonstrate the gold standard:

```dockerfile
FROM alpine:3.21 AS rootfs-stage
ARG S6_OVERLAY_VERSION="3.2.1.0"
ADD https://github.com/.../s6-overlay-noarch.tar.xz /tmp
RUN tar -C /root-out -Jxpf /tmp/s6-overlay-noarch.tar.xz
ADD https://github.com/.../s6-overlay-${ARCH}.tar.xz /tmp
RUN tar -C /root-out -Jxpf /tmp/s6-overlay-${ARCH}.tar.xz

# Runtime stage
FROM scratch
COPY --from=rootfs-stage /root-out/ /
ENV S6_CMD_WAIT_FOR_SERVICES_MAXTIME="0" \
    S6_VERBOSITY=1
COPY root/ /
ENTRYPOINT ["/init"]
```

### 7.4 Proposed Pipeline s6 Service Structure

```
/etc/s6-overlay/s6-rc.d/
├── user/
│   └── contents.d/
│       ├── timescaledb-data-init    # oneshot: chown /data/timescaledb
│       ├── timescaledb              # longrun: postgres -D /data/timescaledb
│       ├── mosquitto                # longrun: mosquitto -c /etc/mosquitto/mosquitto.conf
│       ├── ingest-worker            # longrun: node ingest.js
│       └── node-daemon              # longrun: node server.js
│
├── timescaledb-data-init/
│   ├── type              → "oneshot"
│   ├── dependencies.d/base
│   ├── up                → "/etc/s6-overlay/scripts/timescaledb-init"
│   └── down              → (optional cleanup)
│
├── timescaledb/
│   ├── type              → "longrun"
│   ├── dependencies.d/
│   │   └── timescaledb-data-init
│   ├── run               → "#!/command/execlineb -P\n with-contenv\n s6-setuidgid postgres postgres -D /data/timescaledb"
│   └── finish            → propagate exit code via /run/s6-linux-init-container-results/exitcode
│
├── mosquitto/
│   ├── type              → "longrun"
│   ├── dependencies.d/
│   │   └── timescaledb   ← MQTT only starts after TimescaleDB is ready
│   ├── run               → "#!/command/execlineb -P\n mosquitto -c /etc/mosquitto/mosquitto.conf"
│   └── finish            → propagate exit code
│
├── ingest-worker/
│   ├── type              → "longrun"
│   ├── dependencies.d/
│   │   ├── timescaledb
│   │   └── mosquitto     ← Worker only starts after both DB and MQTT are up
│   ├── run               → "#!/command/with-contenv bash\n exec node /app/ingest.js"
│   └── finish            → propagate exit code, halt on fatal
│
└── node-daemon/
    ├── type              → "longrun"
    ├── dependencies.d/
    │   └── ingest-worker ← API starts after worker is initialized
    ├── run               → "#!/command/with-contenv bash\n exec node /app/server.js"
    └── finish            → propagate exit code

# Critical: main health endpoint checks node-daemon.
# If node-daemon fails, the finish script halts the container.
```

> **Note**: This structure follows the s6-rc source format documented at [skarnet.org/software/s6-rc/s6-rc-compile.html](https://skarnet.org/software/s6-rc/s6-rc-compile.html#source).

---

## 8. Opinionated Recommendation

### Recommendation Table

| Concern | Winner | Rationale |
|---------|--------|-----------|
| **Process supervisor** | **s6-overlay v3** | Proper PID 1, dependency graph, exit-on-failure, no runtime dependency. supervisord fails the critical "exit when Postgres dies" test for ECS. |
| **Init wrapper** | **s6-overlay (built-in)** | s6-svscan IS the init. Do NOT use tini. Disable ECS `InitProcessEnabled`. |
| **Health check model** | **Liveness + Readiness split** | Container health check: simple process-liveness probe. ALB health check: dependency-aware readiness probe. |
| **TimescaleDB storage** | **ECS EBS volume attach (gp3)** | Best performance for WAL. Use snapshot-based lifecycle for task replacement. Fallback: bind mount to pre-attached EBS. |
| **Dockerfile strategy** | **Multi-stage with s6-overlay as first stage** | Follow paperless-ngx pattern: build s6-overlay base in one stage, add services in final stage. |
| **Logging** | **s6-log per-service + CloudWatch containers stdout** | s6-log writes rotated logs locally; Docker/ECS streams combined stdout to CloudWatch. Best of both worlds. |

### Final Verdict

| Dimension | Recommendation |
|-----------|---------------|
| **Init system** | s6-overlay v3.2.2+ |
| **Entrypoint** | `ENTRYPOINT ["/init"]` (no `--init` flag in ECS) |
| **Critical service policy** | TimescaleDB as supervised longrun with `finish` → `halt` on failure |
| **ECS stop timeout** | 90 seconds |
| **s6 gracetime** | `S6_SERVICES_GRACETIME=30000`, `S6_KILL_GRACETIME=15000` |
| **Health check** | Container: `curl -sf http://localhost:8080/live` (simple). ALB: `curl -sf http://localhost:8080/ready` (checks all deps). |
| **TimescaleDB storage** | ECS EBS gp3 volume via `configuredAtLaunch`, with snapshot lifecycle Lambda |
| **WAL archiving** | `wal-g` or `pgBackRest` to S3, triggered by cron oneshot |
| **Image base** | Alpine or Debian slim. Extract s6-overlay tarballs in a staging stage. |
| **Service defs** | s6-rc format (not legacy `/etc/services.d/`) for dependency graph |

**The "one container to rule them all" pattern is valid** when:
1. Each tenant gets an isolated pipeline
2. Data locality (Unix socket writes) is critical for performance
3. Operational simplicity (one task def, one service, one log) outweighs theoretical purity
4. s6-overlay provides proper PID 1 + supervision + exit-on-failure

The days of "supervisord in a container" are over. The industry has converged on s6-overlay as the standard for multi-process Docker images. Paperless-ngx's migration from supervisord to s6-overlay in early 2025 was a watershed moment — if a mature project like paperless-ngx with millions of pulls makes that switch, new projects should start there.

---

## Sources Cited

1. [s6-overlay README (just-containers/s6-overlay)](https://github.com/just-containers/s6-overlay/blob/master/README.md)
2. [MOVING-TO-V3.md](https://github.com/just-containers/s6-overlay/blob/master/MOVING-TO-V3.md)
3. [s6-overlay issue #631 - dependency ordering](https://github.com/just-containers/s6-overlay/issues/631)
4. [s6-overlay issue #535 - ECS Fargate compatibility](https://github.com/just-containers/s6-overlay/issues/535)
5. [s6-overlay issue #585 - signal handling and finish scripts](https://github.com/just-containers/s6-overlay/issues/585)
6. [s6-overlay issue #459 - signal forwarding vs tini](https://github.com/just-containers/s6-overlay/issues/459)
7. [Paperless-ngx PR #8886: supervisord → s6 migration](https://github.com/paperless-ngx/paperless-ngx/pull/8886)
8. [Paperless-ngx Dockerfile (dev branch)](https://github.com/paperless-ngx/paperless-ngx/blob/dev/Dockerfile)
9. [Twenty CRM Dockerfile (twenty-app-dev target)](https://github.com/twentyhq/twenty/blob/main/packages/twenty-docker/twenty/Dockerfile)
10. [LinuxServer.io base image Alpine Dockerfile](https://github.com/linuxserver/docker-baseimage-alpine/blob/master/Dockerfile)
11. [s6-rc overview (skarnet.org)](https://skarnet.org/software/s6-rc/overview.html)
12. [AWS ECS container health checks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/healthcheck.html)
13. [AWS Blog: ECS task health and replacement](https://aws.amazon.com/blogs/containers/a-deep-dive-into-amazon-ecs-task-health-and-task-replacement/)
14. [AWS EBS volumes with ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ebs-volumes.html)
15. [AWS Storage Blog: EBS with Fargate](https://aws.amazon.com/blogs/storage/attaching-block-storage-with-aws-fargate-and-amazon-ebs-volumes/)
16. [AWS re:Post - Manage EBS volumes for ECS](https://repost.aws/knowledge-center/ecs-task-ebs-volume)
17. [TimescaleDB Docker image](https://github.com/timescale/timescaledb-docker)
18. [TimescaleDB self-hosted Docker install docs](https://docs.timescale.com/self-hosted/latest/install/installation-docker/)
19. [TimescaleDB WAL-E sidecar archiving](https://docs.timescale.com/self-hosted/latest/backup-and-restore/docker-and-wale)
20. [Kyle Cascade - Container Init Systems 2025](https://kyle.cascade.family/posts/a-comparison-of-container-init-systems-in-2025/)
21. [ServerSideUp - Using s6-overlay vs supervisord](https://serversideup.net/open-source/docker-php/docs/guide/using-s6-overlay)
22. [Platform Engineers - s6-overlay quickstart](https://platformengineers.io/blog/s6-overlay-quickstart/)
23. [Ahmet Alp Balkan - Choosing an init process for containers](https://ahmet.im/blog/minimal-init-process-for-containers/)
24. [OneUptime - ECS Health Checks 2026](https://oneuptime.com/blog/post/2026-02-12-ecs-health-checks/view)
25. [OneUptime - TimescaleDB on Kubernetes 2026](https://oneuptime.com/blog/post/2026-02-09-timescaledb-kubernetes-timeseries/view)

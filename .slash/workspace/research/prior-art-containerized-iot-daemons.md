# Research: Containerized IoT/MQTT-Bridge Daemon — Prior Art & Best Practices

**Date:** 2026-05-29

## Summary

A survey of six established IoT-edge/ MQTT container packaging strategies (HiveMQ, EMQX, Mosquitto, Node-RED, Home Assistant Supervisor, Balena, AWS IoT Greengrass) covering config injection, TLS/key material handling, Docker access patterns, persistence, and secret management. The dominant pattern for a managed-cloud + self-hosted tier is **env-var-driven config with optional file-mount overrides**, a **config-pull-on-boot from a control-plane API** for the managed variant, and **no docker.sock mount** in production. Persistence leans on **named volumes**; secrets are best injected via **mounted secret volumes** or a **sidecar agent**.

---

## 1. Reference Architectures

### 1.1 HiveMQ MQTT Broker

**Base pattern:** Official Docker images tagged per variant (`base`, `dns-discovery`). The image runs as non-root user `10000`.

**Config injection — dual mechanism:**
1. **Environment variables** mapped to placeholders in `config.xml` using the `${ENV:VAR_NAME}` syntax (since HiveMQ 4.6.0). All cluster settings (discovery address, license, credentials) are env-var configurable.
2. **Mounted config.xml** at `/opt/hivemq/conf/config.xml:ro` for full control.

**TLS/key material:** Java keystore (JKS) files mounted into `/opt/hivemq/cert/`; keystore passwords passed via env vars (`HIVEMQ_KEYSTORE_PASSWORD`).

**Persistence:** Named volumes for `/opt/hivemq/data` and `/opt/hivemq/log` — or bind mounts from host for conf/extensions.

**Sources:**
- [HiveMQ Docker documentation](https://docs.hivemq.com/hivemq/latest/user-guide/docker.html)
- [HiveMQ Community Edition Docker deployment](https://hivemq-hivemq-community-edition.mintlify.app/deployment/docker)
- [hivemq-docker-images README](https://github.com/hivemq/hivemq-docker-images/blob/master/README.md)
- [HiveMQ config env-var substitution docs](https://docs.hivemq.com/hivemq/latest/user-guide/configuration.html)

### 1.2 EMQX MQTT Platform

**Base pattern:** Official Docker image, runs as `emqx` user. Single image unified from v5.9.0+ (BSL license).

**Config injection — env-var prefix mapping:**
- All `etc/emqx.conf` keys are overridable via `EMQX_`-prefixed environment variables.
- Mapping: `EMQX_LISTENERS__TCP__DEFAULT__BIND` → `listeners.tcp.default.bind` (double underscore = `.` separator).
- Prefix is configurable via `HOCON_ENV_OVERRIDE_PREFIX`.
- Node identity set via `EMQX_NODE_NAME=emqx@<fqdn>`.

**TLS/key material (Kubernetes pattern):**
- Kubernetes `Secret` volumes mounted via `extraVolumes`/`extraVolumeMounts` at paths like `/mounted/cert/`.
- TLS listener paths configured in `config.data` string on the CRD.

**Persistence:** PVC-backed volumes for `/opt/emqx/data`. On plain Docker, bind mounts for data dirs. Health check via `/opt/emqx/bin/emqx ctl status`.

**Sources:**
- [EMQX Docker image docs](https://docs.emqx.com/en/emqx/latest/deploy/install-docker.html)
- [emqx/emqx-docker repo](https://github.com/emqx/emqx-docker)
- [EMQX TLS on Kubernetes](https://docs.emqx.com/en/emqx/latest/deploy/kubernetes/operator/tasks/configure-emqx-tls.html)
- [EMQX Docker Hub](https://hub.docker.com/r/emqx/emqx)
- [EMQX Helm chart parameters](https://docs.emqx.com/en/emqx/latest/deploy/kubernetes/chart.html)

### 1.3 Eclipse Mosquitto

**Base pattern:** Minimal Alpine-based image. No ENTRYPOINT wrapper — relies entirely on a mounted config file.

**Config injection — file-mount only:**
- Three predefined directories: `/mosquitto/config`, `/mosquitto/data`, `/mosquitto/log`.
- No env-var override system. Configuration is entirely via `mosquitto.conf` mounted at `/mosquitto/config/mosquitto.conf`.
- Default config refuses non-loopback connections (Mosquitto 2.0+). Custom config must explicitly set `listener` and auth.

**TLS/key material:** Files (PEM) mounted under `/mosquitto/config/`; paths set in `mosquitto.conf`:
```
cafile /mosquitto/config/certs/ca.crt
certfile /mosquitto/config/certs/server.crt
keyfile /mosquitto/config/certs/server.key
```

**Auth:** Password files (`mosquitto_passwd`) or TLS client certificates.

**Sources:**
- [Mosquitto Docker README](https://github.com/eclipse-mosquitto/mosquitto/blob/master/docker/generic/README.md)
- [Docker Hub: eclipse-mosquitto](https://hub.docker.com/_/eclipse-mosquitto)
- [Mosquitto hardened image guide](https://hub.docker.com/hardened-images/catalog/dhi/eclipse-mosquitto/guides)

### 1.4 Node-RED

**Base pattern:** Alpine Node.js-based image. Non-root user `node-red` (uid 1000).

**Config injection — env + mounted settings:**
- Main config in `/data/settings.js` (mounted volume). Environment variables are accessible within flows.
- 12-factor app pattern: config like `NODE_RED_ENABLE_PROJECTS=true` passed as env vars.
- Credential secret set via `credentialSecret` in settings file; credentials encrypted at rest.

**Persistence:** Named volume `node_red_data:/data` stores flows, credentials, settings, nodes, context, libs. UID/GID must match host (1000:1000).

**Sources:**
- [Node-RED Docker guide](https://nodered.org/docs/getting-started/docker)
- [Permissions and Persistence wiki](https://github.com/node-red/node-red-docker/wiki/Permissions-and-Persistence)
- [Docker Hub: nodered/node-red](https://hub.docker.com/r/nodered/node-red)

### 1.5 Home Assistant Supervisor

**Base pattern:** A Python-based supervisor that **orchestrates Docker containers** on behalf of Home Assistant Core. It manages add-ons as sibling containers via the Docker API.

**Key architectural trait — Supervisor as Docker orchestrator:**
- The supervisor mounts the **Docker socket** (`/var/run/docker.sock`) to manage add-on containers.
- Add-on configuration is declared in a `config.yaml` manifest per add-on, NOT env vars.
- The supervisor injects add-on config as:
  - Environment variables (for legacy add-ons)
  - Mounted config files (for modern add-ons)
- Add-ons can declare `host_network: true`, `privileged: true`, device mounts — the supervisor handles Docker create options.

**Config flow (control-plane pull pattern):**
1. HA Supervisor polls Home Assistant cloud/API for configuration updates.
2. Supervisor writes add-on configuration to the host filesystem.
3. Supervisor restarts or reconfigures add-on containers.
4. Add-ons read config from well-known paths or env vars.

**Persistence:** Named Docker volumes managed by supervisor. Backup system serializes all volume data.

**Sources:**
- [Supervisor system architecture (DeepWiki)](https://deepwiki.com/home-assistant/supervisor/1.1-system-architecture)
- [Docker container management](https://deepwiki.com/home-assistant/supervisor/2-docker-container-management)
- [Add-on config and manager](https://deepwiki.com/home-assistant/supervisor/3.1-add-on-manager)
- [supervisor/docker/addon.py](https://github.com/home-assistant/supervisor/blob/5e3f4e8f/supervisor/docker/addon.py)

### 1.6 Balena (balenaCloud / openBalena)

**Base pattern:** IoT-specific OS + container engine + supervisor. Devices run balenaOS (Yocto Linux); containers are managed by the balena Supervisor over the balena Engine (Docker-compatible).

**Config injection — tiered env-var system:**
- **Fleet-level variables:** Apply to all devices in a fleet.
- **Device-level variables:** Override fleet vars for a single device.
- **Service-level variables:** Apply to a specific container/service.
- Hierarchical override: service-device > device-all > fleet-service > fleet-all.
- Variables are set via balenaCloud dashboard, API, CLI, or SDK.
- Supervisor polls the API and re-exposes variables as env vars inside running containers (restarts affected services on change).

**Config-pull-on-boot (native):**
- The supervisor runs as `systemd` on the host OS.
- It polls `api.balena-cloud.com` at a configurable interval (`BALENA_SUPERVISOR_POLL_INTERVAL`).
- On state change (new fleet config, new release), supervisor pulls the target state and applies it.
- `BALENA_`-namespaced env vars provide runtime metadata (supervisor address, API key, host OS version).

**Docker access inside containers:**
- **Supervisor API** at `balena-supervisor:48484` — containers can reconfigure themselves via HTTP.
- **Docker socket mount** is opt-in via the dangerous label `io.balena.features.balena-socket` — not default.

**Sources:**
- [Balena variables docs](https://docs.balena.io/learn/manage/variables)
- [Balena runtime env vars](https://docs.balena.io/learn/develop/runtime)
- [Balena configuration](https://docs.balena.io/learn/manage/configuration)
- [Supervisor API reference](https://docs.balena.io/reference/supervisor/supervisor-api.md)
- [Docker Compose fields reference (balena labels)](https://docs.balena.io/reference/supervisor/docker-compose.md)

### 1.7 AWS IoT Greengrass V2

**Base pattern:** Java-based nucleus running on the device, managing components (plugins or Lambda-style processes). Can run natively or inside a Docker container.

**Config injection — merge/patch model:**
- **Component recipes** declare default config as JSON.
- **Deployments** apply "merge updates" and "reset updates" — patch operations, not full replaces.
- Greengrass supports recipe variable interpolation: `{iot:thingName}`, `{aws:region}`, etc.
- Component lifecycle scripts receive **environment variables** set by the nucleus (`AWS_GG_NUCLEUS_DOMAIN_SOCKET_FILEPATH_FOR_COMPONENT`, `SVCUID`, etc.).
- Custom env vars per component via the `Setenv` lifecycle setting.

**Secret management:** Built-in `aws.greengrass.SecretManager` component:
- Deploys encrypted Secrets Manager secrets to the core device.
- Components retrieve secrets via IPC (`aws.greengrass#GetSecretValue`).
- IAM-based access control; authorization policies restrict secrets per component.

**Docker access patterns:**
- Greengrass v2 nucleus can run **inside Docker** but does not natively support running child Docker containers (no DinD).
- AWS Prescriptive Guidance documents a **DinD (Docker-in-Docker) extension** for Greengrass that uses a custom image with Docker Engine inside.
- Alternatively, Greengrass can manage Docker containers via the **Docker application manager component** if Docker Engine is installed on the host (uses host Docker — not docker.sock mount from inside Greengrass).

**Persistence:** Greengrass root at `/greengrass/v2/` — uses the host filesystem directly or bind mounts when containerized.

**Sources:**
- [Greengrass Docker container deployment](https://docs.aws.amazon.com/prescriptive-guidance/latest/patterns/deploy-containerized-applications-on-aws-iot-greengrass-version-2-running-as-a-docker-container.html)
- [Run Greengrass in Docker](https://docs.aws.amazon.com/greengrass/v2/developerguide/run-greengrass-docker.html)
- [Update component configurations](https://docs.aws.amazon.com/greengrass/v2/developerguide/update-component-configurations.html)
- [Secret Manager component](https://docs.aws.amazon.com/greengrass/v2/developerguide/secret-manager-component.html)
- [Component environment variables](https://docs.aws.amazon.com/greengrass/v2/developerguide/component-environment-variables.html)
- [Component recipe reference](https://docs.aws.amazon.com/greengrass/v2/developerguide/component-recipe-reference.html)

---

## 2. Config Injection Mechanisms — Tradeoff Analysis

| Mechanism | Projects Using | Rotation | Audit | Restart Cost | Complexity |
|---|---|---|---|---|---|
| **Env vars** (`EMQX_*`, `HIVEMQ_*`, Balena) | EMQX, HiveMQ, Balena, Node-RED (partial) | Requires container restart (Docker) or `docker kill --signal=HUP` if the app supports it | Logged in orchestrator only | Medium (container restart) | Low |
| **Mounted config file** (`config.xml`, `mosquitto.conf`, `settings.js`) | Mosquitto, HiveMQ, Node-RED, EMQX (via CRD) | Mount a new file; app may need SIGHUP or restart | File-level auditing via orchestrator | Low to medium (SIGHUP vs restart) | Low |
| **Config-pull-on-boot from control-plane API** | Balena, HA Supervisor, IoT Edge (twin) | Polling interval (30s–5min); no restart needed if app supports hot-reload | Central audit log at control plane | Low (no restart for hot-reload) | Medium-high (needs auth, retry, backoff) |
| **API-pull with sidecar** | Greengrass (Secrets Manager), Vault Agent | Sidecar manages refresh cycle transparently | Sidecar logs & metrics | None (app reads local file/HTTP) | High |
| **Device twin desired properties** | Azure IoT Edge | Twin update triggers module restart | Cloud-side audit trail | Medium (module restart) | Medium |

### Config-Pull-on-Boot (Managed Tier Pattern)

**How Balena does it:**
1. Device boots → Supervisor starts.
2. Supervisor fetches target state from `api.balena-cloud.com` (includes fleet/device vars, service definitions).
3. Supervisor starts/restarts containers with resolved env vars.
4. On config change in dashboard → Supervisor detects poll response delta → restarts affected services.

**How HA Supervisor does it:**
1. Supervisor polls Home Assistant cloud for config updates.
2. On change, writes add-on config to known paths, then calls Docker API to restart add-on.

**Recommendation for a daemon:**
- On boot: fetch full config from control-plane API (with exponential backoff, 10s base, 5min cap).
- Cache config to a local file (for offline resilience).
- Subscribe to real-time config updates (WebSocket or SSE) when connected.
- Support hot-reload mechanism (SIGHUP or internal timer) to re-read config without container restart.

### 12-Factor App Alignment

The 12-factor [Config](https://12factor.net/config) rule says: "Store config in the environment." The surveyed projects split:

- **Strict env-var** (EMQX, HiveMQ's `${ENV:}` system) — closest to 12-factor.
- **Hybrid** (Node-RED, Greengrass) — env vars for runtime context, mounted files for structured config.
- **File-only** (Mosquitto) — pragmatic for complex config but violates strict 12-factor.

**Verdict:** A hybrid approach serves a daemon best — env vars for secrets and simple overrides, a mounted/locally-cached YAML for structured config (bridge routes, transform rules, etc.).

---

## 3. TLS/Key Material Handling

| Approach | Used By | Rotation Mechanism | Notes |
|---|---|---|---|
| **Mounted JKS keystore** | HiveMQ | Replace file + restart or HUP | Password via env var |
| **Mounted PEM files** | Mosquitto, EMQX (K8s) | Replace file + SIGHUP on supported configs | Simplest, works everywhere |
| **Mounted Kubernetes Secret** | EMQX (operator) | `kubectl delete pod` or K8s auto-rotation with subPath | K8s-native |
| **AWS Secrets Manager + Greengrass** | AWS IoT Greengrass | Agent auto-refreshes on schedule | Requires cloud dependency |
| **Vault Agent sidecar** | HashiCorp reference | Agent handles renewal & rotation | Higher complexity, strongest audit |

**Key findings:**
- **For self-hosted:** Mounted PEM files with a periodic reload signal is the simplest, most portable pattern.
- **For managed tier:** The daemon should support both mounted files AND an API-path where the control plane pushes certs on connect.
- **Hot-reload of TLS** (without process restart) is supported by EMQX and HiveMQ — daemon should implement the same via periodic stat() on cert files or a reload endpoint.

**Sources:**
- [HiveMQ TLS with JKS](https://hub.docker.com/r/peez/hivemq) (keystore mount example)
- [Mosquitto TLS guide](https://techsparx.com/software-development/mqtt/mosquitto-ssl.html)
- [EMQX TLS via K8s Secrets](https://docs.emqx.com/en/emqx/latest/deploy/kubernetes/operator/tasks/configure-emqx-tls.html)
- [AWS Greengrass Secret Manager](https://docs.aws.amazon.com/greengrass/v2/developerguide/secret-manager-component.html)

---

## 4. Docker Access Patterns Inside the Daemon

### Options

| Pattern | Mount | Security | Use Case | Examples |
|---|---|---|---|---|
| **None** (no Docker access) | — | 🟢 Best | The daemon does NOT manage containers | Mosquitto, EMQX, HiveMQ, Node-RED |
| **docker.sock mount** | `-v /var/run/docker.sock:/var/run/docker.sock` | 🟡 Dangerous (root-equivalent on host) | Daemon orchestrates sibling containers | HA Supervisor, Jenkins-in-Docker, Balena (opt-in) |
| **DinD (Docker-in-Docker)** | `--privileged` + `docker:dind` image | 🟠 Privileged, higher overhead | Full container lifecycle inside a container | AWS IoT Greengrass DinD extension |
| **Supervisor API** (HTTP, not Docker API) | Network-only | 🟢 Good | Limited, specific management operations | Balena Supervisor API |

**Security guidance:**
- **Do NOT mount docker.sock** in the production daemon. It gives root-equivalent host access.
- Microsoft's Azure IoT Edge on Kubernetes guidance explicitly warns: *"Do not mount docker.sock into any module! [...] it essentially gives the module root privileges on the system."* See: [Avoid using Docker socket](https://microsoft.github.io/iotedge-k8s-doc/bp/docksock.html)
- If the daemon MUST manage containers (e.g., it is a supervisor), prefer the **Supervisor API** pattern (Balena) over raw docker.sock.
- DinD is appropriate only when the daemon must build or run fully isolated containers (CI runners, edge-compute sandboxing).

**Sources:**
- [Docker-in-Docker vs DooD analysis](https://dev.to/flnzba/37-running-a-docker-container-in-a-docker-container-1de8)
- [Microsoft IoT Edge: avoid Docker socket](https://microsoft.github.io/iotedge-k8s-doc/bp/docksock.html)
- [Azure/iotedge issue #7408: bind vs volume mounts](https://github.com/Azure/iotedge/issues/7408)

---

## 5. Persistence Strategies

| Strategy | Managed By | Portable | Performance | Use Case | Examples |
|---|---|---|---|---|---|
| **Named volume** | Docker | 🟢 Yes | 🟢 Best | Production persistent data | Node-RED (`node_red_data`), EMQX (Helm PVC), HiveMQ CE |
| **Bind mount** | User/host | 🔴 Host-tied | 🟢 Good | Dev, logs, config files that need host access | Mosquitto (`$PWD/config`), HiveMQ (`./conf`) |
| **Ephemeral + remote store** | Application | 🟢 Fully portable | 🟡 Depends on network | Buffers, temp data, reconnect-safe caches | Custom IoT bridge pattern |
| **tmpfs** (in-memory) | Docker | 🟢 Yes | 🚀 Fastest | Temporary secrets, non-persistent cache | Multi-container ephemeral use |

**Docker's own recommendation:** *"Volumes are the preferred mechanism for persisting data generated by and used by Docker containers."* — [Docker storage docs](https://github.com/docker/docs/blob/main/content/manuals/engine/storage/volumes.md)

**For an IoT bridge daemon specifically:**
- **Named volumes** for persistent data (message buffer queue, DB state).
- **Bind mounts only** for config that the user must edit directly on the host.
- **Remote object store** (S3-compatible) for IoT data that must survive container and node loss — implement a flush-on-connect pattern.
- The Azure IoT Edge team migrated from bind mounts to volumes after community feedback, validating volumes as the correct default. See: [Azure/iotedge issue #7408](https://github.com/Azure/iotedge/issues/7408).

---

## 6. Key/Secret Management at the Container Level

| Method | Description | Rotation | Complexity | Audit | Examples |
|---|---|---|---|---|---|
| **Environment variable** | Secret passed as `-e SECRET=...` | Container restart | 🟢 Low | 🟡 Logged in process list | Balena, EMQX, HiveMQ |
| **Mounted file** | Secret written to file on shared volume | File replacement (+ app reload) | 🟢 Low | 🟢 File-level | Mosquitto (password files), Vault Agent sidecar pattern |
| **Kubernetes Secret volume** | Declarative secret mount in K8s | K8s controller handles replacement | 🟡 Medium (K8s knowledge) | 🟢 Full audit trail | EMQX operator, Greengrass K8s |
| **AWS Secrets Manager Agent sidecar** | Local HTTP cache at `localhost:2773` | Auto-refresh (configurable TTL) | 🟡 Medium | 🟢 Full AWS CloudTrail | [AWS blog](https://aws.amazon.com/blogs/security/using-aws-secrets-manager-agent-with-amazon-eks/) |
| **HashiCorp Vault sidecar** | Vault Agent renders secrets to shared volume or Unix socket | Agent handles lifecycle | 🔴 High | 🟢 Full audit | [HashiCorp Vault sidecar tutorial](https://developer.hashicorp.com/vault/tutorials/kubernetes/kubernetes-sidecar) |
| **Secrets Manager in Greengrass** | IPC call `aws.greengrass#GetSecretValue` | Auto-refreshed by nucleus | 🟡 Medium | 🟢 CloudTrail | [Greengrass Secrets Manager](https://docs.aws.amazon.com/greengrass/v2/developerguide/secret-manager-component.html) |
| **Azure IoT Edge module twin** | Desired properties pushed from cloud | On cloud-twin update | 🟡 Medium | 🟢 Cloud audit | [Azure IoT Edge twins](https://learn.microsoft.com/en-us/azure/iot-edge/module-edgeagent-edgehub) |

### Recommendations for a Containerized IoT Bridge Daemon

**For the managed cloud tier:**
- Use **AWS Secrets Manager Agent sidecar** or equivalent — provides HTTP-based secret access without the daemon needing AWS SDK, supports automatic rotation without container restart, and caches with configurable TTL.
- Fall back to **mounted secret files** for environments without a secrets manager.

**For the self-hosted tier:**
- Support **env var** (simple, universal) and **mounted file** (Docker-native, works with Docker secrets, Kubernetes secrets, and manual config).
- Optionally support **Vault Agent sidecar** for organizations already on Vault.

**TLS-specific recommendations:**
- Mount certs as **files** in both tiers — this is the most portable and well-understood pattern.
- Implement **SIGHUP or internal timer** to reload certs without restart.
- For managed tier, push rotated certs via the config-pull API; the daemon writes them to its local cache and reloads.

---

## 7. Synthesis: Recommended Architecture for a "Containerized Daemon Variant"

```
┌─────────────────────────────────────────────────┐
│                  CLOUD CONTROL PLANE             │
│  Config API ─── Secrets Manager ─── Device Twin  │
└──────────────────┬──────────────────────────────┘
                   │ HTTPS / WSS
                   ▼
┌─────────────────────────────────────────────────┐
│                D A E M O N   C O N T A I N E R    │
│                                                   │
│  ┌──────────────┐    ┌────────────────────────┐   │
│  │ boot.sh      │───▶│ config-pull (retry)     │   │
│  │ (entrypoint) │    │ - fetch config from API │   │
│  └──────────────┘    │ - fetch secrets         │   │
│                      │ - write to /var/run/    │   │
│                      │   config.json           │   │
│                      │ - write certs to        │   │
│                      │   /var/run/certs/       │   │
│                      └───────────┬────────────┘   │
│                                  │                │
│                      ┌───────────▼────────────┐   │
│                      │  daemon main process    │   │
│                      │  - watches for reload   │   │
│                      │  - SIGHUP/periodic stat │   │
│                      │  - MQTT/IoT bridge loop │   │
│                      └───────────┬────────────┘   │
│                                  │                │
│  ┌──────────────┐    ┌───────────▼────────────┐   │
│  │ named volume  │    │  /var/run/ secrets +   │   │
│  │ /data         │    │  config (tmpfs/ephem)  │   │
│  └──────────────┘    └────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

**Key design decisions:**

| Concern | Managed Tier | Self-Hosted Tier |
|---|---|---|
| Config source | API-pull on boot + WebSocket push | Mounted YAML file |
| Secrets | Sidecar agent or API-pull | Env var or mounted Docker secret |
| TLS | API-push + auto-reload | Mounted PEM files + SIGHUP |
| Docker socket | **NEVER** mount | **NEVER** mount |
| Persistence | Named volume for buffer; flush to S3 on connect | Named volume |
| Restart cost | Low (hot-reload for config/secrets) | Low (file-reload) |
| Offline resilience | Cached config from last successful API pull | Config is always local |

---

## Sources Index

1. **HiveMQ Docker docs** — https://docs.hivemq.com/hivemq/latest/user-guide/docker.html
2. **HiveMQ config env-var** — https://docs.hivemq.com/hivemq/latest/user-guide/configuration.html
3. **HiveMQ docker-images repo** — https://github.com/hivemq/hivemq-docker-images
4. **HiveMQ CE deployment** — https://hivemq-hivemq-community-edition.mintlify.app/deployment/docker
5. **EMQX Docker install** — https://docs.emqx.com/en/emqx/latest/deploy/install-docker.html
6. **emqx-docker repo** — https://github.com/emqx/emqx-docker
7. **EMQX TLS on K8s** — https://docs.emqx.com/en/emqx/latest/deploy/kubernetes/operator/tasks/configure-emqx-tls.html
8. **EMQX Helm chart** — https://docs.emqx.com/en/emqx/latest/deploy/kubernetes/chart.html
9. **Mosquitto Docker README** — https://github.com/eclipse-mosquitto/mosquitto/blob/master/docker/generic/README.md
10. **Mosquitto Docker Hub** — https://hub.docker.com/_/eclipse-mosquitto
11. **Mosquitto TLS guide** — https://techsparx.com/software-development/mqtt/mosquitto-ssl.html
12. **Node-RED Docker guide** — https://nodered.org/docs/getting-started/docker
13. **Node-RED permissions wiki** — https://github.com/node-red/node-red-docker/wiki/Permissions-and-Persistence
14. **HA Supervisor architecture (DeepWiki)** — https://deepwiki.com/home-assistant/supervisor/1.1-system-architecture
15. **HA Supervisor docker/addon.py** — https://github.com/home-assistant/supervisor/blob/5e3f4e8f/supervisor/docker/addon.py
16. **Balena variables** — https://docs.balena.io/learn/manage/variables
17. **Balena runtime env** — https://docs.balena.io/learn/develop/runtime
18. **Balena Supervisor API** — https://docs.balena.io/reference/supervisor/supervisor-api.md
19. **Balena docker-compose labels** — https://docs.balena.io/reference/supervisor/docker-compose.md
20. **Greengrass container pattern** — https://docs.aws.amazon.com/prescriptive-guidance/latest/patterns/deploy-containerized-applications-on-aws-iot-greengrass-version-2-running-as-a-docker-container.html
21. **Greengrass in Docker** — https://docs.aws.amazon.com/greengrass/v2/developerguide/run-greengrass-docker.html
22. **Greengrass update component config** — https://docs.aws.amazon.com/greengrass/v2/developerguide/update-component-configurations.html
23. **Greengrass Secret Manager** — https://docs.aws.amazon.com/greengrass/v2/developerguide/secret-manager-component.html
24. **Greengrass component env vars** — https://docs.aws.amazon.com/greengrass/v2/developerguide/component-environment-variables.html
25. **Greengrass component recipe** — https://docs.aws.amazon.com/greengrass/v2/developerguide/component-recipe-reference.html
26. **Docker volumes docs** — https://github.com/docker/docs/blob/main/content/manuals/engine/storage/volumes.md
27. **Docker bind mounts** — https://github.com/docker/docs/blob/main/content/manuals/engine/storage/bind-mounts.md
28. **Azure IoT Edge vs volume mounts (issue)** — https://github.com/Azure/iotedge/issues/7408
29. **Azure IoT Edge device twins** — https://learn.microsoft.com/en-us/azure/iot-edge/module-edgeagent-edgehub
30. **Azure IoT Edge module twins** — https://learn.microsoft.com/en-us/azure/iot-hub/iot-hub-devguide-module-twins
31. **Microsoft IoT Edge K8s: avoid Docker socket** — https://microsoft.github.io/iotedge-k8s-doc/bp/docksock.html
32. **Docker socket security analysis** — https://dev.to/flnzba/37-running-a-docker-container-in-a-docker-container-1de8
33. **AWS Secrets Manager Agent + EKS** — https://aws.amazon.com/blogs/security/using-aws-secrets-manager-agent-with-amazon-eks/
34. **HashiCorp Vault sidecar injector** — https://developer.hashicorp.com/vault/tutorials/kubernetes/kubernetes-sidecar
35. **Vault Agent on ECS** — https://developer.hashicorp.com/vault/tutorials/vault-agent/agent-aws-ecs
36. **12-Factor App Config** — https://12factor.net/config

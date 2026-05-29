# Research: Container TLS Certificate & Key Management for MQTT Daemon

**Date**: 2026-05-29

## Summary

Production patterns for TLS material in containerized daemons fall along a spectrum from "baked into image" (worst) to "fetched at boot from a control plane" (best). Key rotation without downtime is achievable via `GetCertificate`-style callbacks (Go), SIGHUP reload, or file-watch loops. For multi-tenant MQTT daemons, mTLS-per-org offers strongest isolation at higher complexity; single-cert with topic ACLs is simpler but shifts trust to the authz layer. Per-org broker credentials are best stored with KMS envelope encryption or fetched just-in-time. Retention buffers containing sensitive payloads should leverage filesystem-level encryption (dm-crypt/LUKS on the volume) or application-layer encryption with per-tenant DEKs.

---

## 1. Bootstrapping TLS Material in Containers

### 1.1 Baked into Image (Bad)

Embedding certificates and private keys in a container image is universally considered an anti-pattern. Secrets in Docker image layers can be extracted via `docker history` and are visible to anyone with image pull access.

**Evidence**: GitGuardian's analysis found that ~7% of public Docker Hub images contained at least one hardcoded secret. ([source](https://blog.gitguardian.com/how-to-handle-secrets-in-docker/))

### 1.2 Mounted Secret Volume (Good)

The simplest production-grade approach: mount TLS material via Docker Secrets (Swarm mode) or Kubernetes Secrets mounted as volumes.

**Docker Swarm Secrets**: Secrets are encrypted in the Raft log, transmitted over mTLS to managers, decrypted only at container start, and mounted on a `tmpfs` RAM-backed filesystem at `/run/secrets/<name>`. The file is unmounted when the container stops. ([Docker docs](https://docs.docker.com/engine/swarm/secrets/))

**Kubernetes Secrets as volumes**: Mount the Secret directory into the pod. cert-manager writes updated certificates back to the same Secret object, which updates the mounted files on disk (symlink swap). The application must then detect the file change and reload.

**Evidence**: "Docker secrets encrypt data at rest, restrict access to only the containers that need them, and mount secrets on a memory-backed filesystem (tmpfs)." ([Wiz Academy](https://www.wiz.io/academy/container-security/docker-secrets))

### 1.3 Fetched at Boot from Control Plane

The daemon fetches its TLS identity at startup from a secrets store (Vault, AWS Secrets Manager, etc.) using a bootstrap token or instance identity document, then keeps the material in memory only.

**Pattern**:
- Container starts with a short-lived bootstrap token (e.g., Kubernetes ServiceAccount JWT)
- Authenticates to Vault using Kubernetes Auth method
- Retrieves PKI certificate + key from Vault's PKI secrets engine
- Keeps material in-memory; never writes to disk

**Evidence**: "Vault Agent handles authentication, secret fetching, token renewal, and secret refreshing — writing secrets to files. The application never calls Vault APIs." ([HashiCorp Vault Agent Injector docs](https://developer.hashicorp.com/vault/docs/deploy/kubernetes/injector))

### 1.4 cert-manager (Kubernetes-native)

cert-manager is the de facto standard for TLS certificate management in Kubernetes. It watches `Certificate` CRDs and writes renewed certificates as Kubernetes `Secret` objects.

- Supports ACME (Let's Encrypt), Vault Issuer, CA Issuer, self-signed
- Automatic renewal before expiry (default: renew at 2/3 of lifetime)
- CNCF graduated project — 86% of new production clusters deploy cert-manager ([Infisical](https://infisical.com/blog/best-certificate-management-tools))

**Evidence**: "cert-manager is capable of automating certificate issuance and renewal natively within Kubernetes, with ACME protocol support for Let's Encrypt and other issuers." ([Infisical, "Best Certificate Management Tools in 2026"](https://infisical.com/blog/best-certificate-management-tools))

### 1.5 Vault Agent Injector (Sidecar Pattern)

The Vault Agent Injector is a Kubernetes mutation webhook that adds a Vault Agent sidecar container to pods. The sidecar authenticates to Vault, fetches secrets, templates them to a shared memory volume, and can auto-renew tokens.

- **Init container mode**: Fetch secrets before app starts
- **Sidecar mode**: Sidecar keeps secrets refreshed; app reads files at any time
- **Template rendering**: Go templates transform raw secrets into config files

**Evidence**: "Vault Agent Injector alters pod specifications to include Vault Agent containers that render Vault secrets to a shared memory volume using Vault Agent Templates. By rendering secrets to a shared volume, containers within the pod can consume Vault secrets without being Vault aware." ([Vault Agent Injector docs](https://developer.hashicorp.com/vault/docs/deploy/kubernetes/injector))

### 1.6 AWS ACM Private CA + IAM Roles Anywhere

For daemons running outside Kubernetes (EC2, on-prem, hybrid), AWS IAM Roles Anywhere lets workloads authenticate using X.509 certificates from ACM Private CA or an external PKI. The daemon trades its certificate for temporary AWS credentials, then can fetch secrets or TLS material from Parameter Store/Secrets Manager.

**Pattern**:
1. Device has a client certificate signed by ACM Private CA (or external PKI)
2. Calls IAM Roles Anywhere to exchange certificate → temporary AWS credentials
3. Uses credentials to access Secrets Manager / ACM for TLS materials

**Evidence**: "IAM Roles Anywhere enables workloads outside of AWS to access AWS resources using X.509 digital certificates. This service allows servers, containers, and applications to obtain temporary AWS credentials for IAM roles and policies." ([AWS IAM Roles Anywhere](https://aws.amazon.com/iam/roles-anywhere/))

**Trust anchors** can be ACM Private CA certificates or external CA bundles. Sessions are short-lived (15 min to 60 min). ([Unit 42 analysis](https://unit42.paloaltonetworks.com/aws-roles-anywhere/))

### Summary: Bootstrapping Comparison

| Method | Persistence | Rotation | Complexity | Best For |
|--------|-------------|----------|------------|----------|
| Baked into image | Permanent | Requires rebuild | None | Dev only |
| Mounted secret volume | Disk (tmpfs) | Replace + SIGHUP | Low | Single-tenant services |
| cert-manager | K8s Secret | Auto-renew + volume update | Medium | K8s-native workloads |
| Vault Agent sidecar | RAM+tmpfs | Auto-renew + templating | High | Multi-tenant with existing Vault |
| ACM PCA + Roles Anywhere | RAM (fetched on boot) | Cert expiry re-triggers | Medium | AWS-adjacent workloads |
| Fetched at boot | RAM only | Re-fetch on SIGHUP | High | Maximum security requirements |

---

## 2. Key Rotation Strategies Without Downtime

### 2.1 GetCertificate Callback (Go)

In Go, instead of setting `tls.Config.Certificates` (which is static), set `GetCertificate` to a callback that loads the cert+key from disk (or memory) on every handshake. The callback reads the latest file contents, so updating the file on disk is immediately reflected in new TLS handshakes.

**Code pattern**:
```go
tls.Config{
    GetCertificate: func(*tls.ClientHelloInfo) (*tls.Certificate, error) {
        cert, err := tls.LoadX509KeyPair(certPath, keyPath)
        if err != nil {
            return nil, fmt.Errorf("could not load TLS cert: %s", err)
        }
        return &cert, nil
    },
}
```

**Evidence**: "If you use tls.Config struct from crypto/tls package, then instead of using Certificates member implement the GetCertificate member... the new certificates are used for all new connections without needing to restart the server." ([Nikunj Rathi, "Zero downtime Certificate rotation for Go applications"](https://medium.com/@rathinikunj/zero-downtime-certificate-rotation-for-go-applications-a946b91cb83c))

**Limitation**: `GetCertificate` is called per-handshake. For very high throughput, add caching with periodic re-read or use a file watcher (e.g., `fsnotify`) to update an atomic pointer.

### 2.2 File Watcher + Atomic Swap

Use `fsnotify` or `inotify` to watch the certificate directory for changes, then atomically swap a pointer to the new `tls.Certificate`. New connections use the new cert; existing connections continue with the old one until they close naturally.

**Implementation pattern**:
```go
type CertManager struct {
    mu    sync.RWMutex
    cert  *tls.Certificate
}

func (cm *CertManager) Watch(certFile, keyFile string) {
    watcher, _ := fsnotify.NewWatcher()
    watcher.Add(filepath.Dir(certFile))
    go func() {
        for range watcher.Events {
            cert, err := tls.LoadX509KeyPair(certFile, keyFile)
            if err == nil {
                cm.mu.Lock()
                cm.cert = &cert
                cm.mu.Unlock()
            }
        }
    }()
}

func (cm *CertManager) GetCertificate(chi *tls.ClientHelloInfo) (*tls.Certificate, error) {
    cm.mu.RLock()
    defer cm.mu.RUnlock()
    return cm.cert, nil
}
```

**Evidence**: "Certman watches for changes to your certificate and key files and reloads them on change allowing the server to stay online during certificate changes." ([dyson/certman](https://github.com/dyson/certman))

### 2.3 SIGHUP Reload

Traditional UNIX pattern: send SIGHUP to the daemon, which re-reads certificate files from known paths and swaps TLS configs. Requires the daemon to implement a SIGHUP handler.

**For inbound TLS (server)**: New connections after the reload use the new cert. Existing connections are unaffected (TLS handshake already completed).

**For outbound TLS (client)**: More nuanced — existing persistent connections to MQTT brokers continue with their negotiated session. New connections or TLS session resumptions use the updated client certificate. If mTLS is in use, the broker sees the new client cert.

**Evidence**: "The kueue-controller-manager's metrics endpoint failed to reload updated TLS certificates after cert-manager renewal. The fix: add file watching and hot-reload." ([Kueue issue #9005](https://github.com/kubernetes-sigs/kueue/issues/9005))

### 2.4 Dual-Cert Overlap (JWKS-style Rotation)

Borrowed from JWKS signing key rotation: publish both old and new certificates simultaneously, let clients and peers see both, then switch signing to the new key before retiring the old one.

**Phases**:
1. **Normal**: Single cert in use
2. **Introduce new**: Publish both old and new; keep signing with old
3. **Switch**: Sign with new; accept both for verification; wait for cache TTLs
4. **Retire**: Remove old cert

This is useful when the daemon serves as a TLS server for device connections and devices cache the server certificate/CA. The daemon presents both certs via SNI (`GetConfigForClient`) during the overlap window.

**Evidence**: "JWKS enables zero-downtime key rotation through a four-phase process: normal operation → introduce new key (both published) → switch to new key (both still published) → remove old key." ([David Sulc, "JWKS and Zero-Downtime Key Rotation"](https://www.davidsulc.com/blog/jws-apis-jwks-basics))

### 2.5 Modern TLS 1.3 0-RTT / PSK Considerations

TLS 1.3 session resumption uses PSKs derived from the previous handshake. After a cert rotation, clients with cached PSKs may attempt to resume. The server should either accept PSKs from the old epoch or force full handshakes post-rotation. This is typically transparent — TLS 1.3 handles PSK invalidation gracefully.

---

## 3. mTLS-per-Org vs. Single-Cert-Shared with Topic ACL

### 3.1 Single-Cert-Shared with Topic ACL

The daemon uses one TLS client certificate for all outbound MQTT connections. Per-org routing is handled at the MQTT topic level (e.g., `orgs/{org_id}/devices/{device_id}/telemetry`). Authorization is enforced by broker-side ACLs.

**Pros**:
- Simple: one cert to manage, one cert to rotate
- Low overhead: one TLS session pool
- Easy onboarding: new orgs need only ACL changes, no cert issuance

**Cons**:
- No cryptographic tenant isolation: all orgs share the same TLS identity
- If the cert leaks, all orgs' communication channels are compromised
- The broker must implement robust ACL enforcement (topic-based)
- Audit trail is weaker — all connections appear from the same identity

**Real-world pattern**: ChirpStack's LoRaWAN server uses a single Mosquitto MQTT broker with `use_identity_as_username true` and `pattern readwrite +/gateway/%u/#` ACLs. The CN from the client cert becomes the MQTT username, which is matched against topic patterns. ([ChirpStack docs: Mosquitto TLS config](https://www.chirpstack.io/docs/guides/mosquitto-tls-configuration.html))

### 3.2 mTLS-per-Org

Each organization gets a unique client certificate (likely issued by an internal CA, e.g., Vault PKI). The daemon maintains a pool of TLS connections, each identified by a different client cert.

**Pros**:
- **Cryptographic tenant isolation**: Each org has its own TLS identity and key material
- **Granular revocation**: Compromised per-org cert → revoke just that cert; other orgs unaffected
- **Stronger audit**: Broker sees unique client cert per org; logs identify the org cryptographically
- **Compliance**: Meets requirements for "customer-managed" or "dedicated credential" scenarios

**Cons**:
- **Operational complexity**: N certs to issue, rotate, monitor expiry for N orgs
- **Connection overhead**: N TLS session pools (one per org) instead of one
- **Key storage**: The daemon must store N private keys securely (→ see Section 4)
- **Rotation**: Rolling all orgs' certs is a multi-step orchestration

**MQTT broker support**: EMQX supports certificate-based authentication with per-client ACLs. Each connecting client can present a unique cert. The CN or Subject is mapped to an MQTT username, enabling fine-grained ACL rules. ([EMQX MQTT broker comparison](https://www.emqx.com/en/blog/a-comprehensive-comparison-of-open-source-mqtt-brokers-in-2023))

### 3.3 Hybrid: Per-Org Client Cert + Shared Server Cert

A pragmatic middle-ground:
- **Outbound to brokers**: Per-org client certs for mTLS authentication (cryptographic isolation)
- **Inbound from devices**: A single server certificate (or wildcard SAN cert) for the daemon's TLS termination — org identification via device client certs (mTLS handshake)

This means the daemon's **inbound** TLS termination uses one server cert (simple), while **outbound** mTLS connections to per-org brokers use distinct client certs.

### Trade-off Decision Matrix

| Factor | Single-Cert + ACL | mTLS-per-Org | Hybrid |
|--------|-------------------|--------------|--------|
| Cert management overhead | Low | High | Medium |
| Tenant isolation | None (solely ACL) | Cryptographic | Mixed |
| Rotation complexity | Low | High | Medium |
| Key storage burden | 1 key | N keys | N + 1 keys |
| Broker-side changes | ACL only | ACL + trust config | Per connection |
| Audit granularity | Connection-level | Per-org identity | Per-org identity |
| Leak blast radius | All orgs | Single org | Single org (outbound) |

---

## 4. Storing Per-Org Broker Credentials

When the daemon serves multiple orgs, each with distinct broker TLS credentials (client cert + key, or username/password), the daemon must store N sets of credentials securely.

### 4.1 Encrypted-at-Rest with Application-Level Keys

The simplest approach: encrypt all credential blobs at rest using a single application-level key, stored in an environment variable or a mounted secret. On startup, decrypt the credential database into memory.

**Problem**: If the app key leaks, all per-org credentials are compromised. No tenant isolation at the encryption layer.

### 4.2 KMS Envelope Encryption (Recommended)

**Pattern**:
1. A master Key Encryption Key (KEK) is stored in AWS KMS / GCP Cloud KMS / Azure Key Vault
2. For each org, generate a unique Data Encryption Key (DEK)
3. Encrypt the org's credentials with the DEK
4. Wrap (encrypt) the DEK with the KEK → store the wrapped DEK alongside the ciphertext
5. On startup / when loading an org's credentials: send wrapped DEK to KMS for unwrap, use plaintext DEK to decrypt locally, discard DEK after use (or cache briefly)

**Benefits**:
- **Per-tenant encryption domain**: Each org's DEK is unique; a KMS audit log shows which orgs' keys were accessed
- **Central key management**: KEK rotation re-wraps all DEKs without re-encrypting credentials
- **KMS never sees plaintext credentials**: Only the DEK (which is a random binary key, not the credential itself)

**Evidence**: "Envelope encryption is the process of encrypting a key with another key. The key used to encrypt data itself is called a data encryption key (DEK). The DEK is encrypted by a key encryption key (KEK)." ([Google Cloud KMS docs: Envelope encryption](https://docs.cloud.google.com/kms/docs/envelope-encryption))

**Evidence**: AWS's multi-tenant encryption blog recommends "moving from multiple service-specific KMS keys per tenant to a single KMS key per tenant that is shared securely across services." ([AWS Architecture Blog](https://aws.amazon.com/blogs/architecture/simplify-multi-tenant-encryption-with-a-cost-conscious-aws-kms-key-strategy/))

**Go implementation** (from AWS blog):
```go
// GenerateDataKey returns a plaintext DEK and a wrapped ciphertext blob
result, err := kms.GenerateDataKey(ctx, &kms.GenerateDataKeyInput{
    KeyId:   aws.String("alias/tenant-org-123"),
    KeySpec: aws.String("AES_256"),
})
// Use result.Plaintext to encrypt credentials locally
// Store result.CiphertextBlob alongside encrypted credentials
```

### 4.3 Just-in-Time (JIT) Fetch

Rather than storing credentials at rest in the daemon at all, fetch them on-demand from a secrets store when a connection for that org is needed:
- Daemon receives a connection or message for org X
- Authenticates to Vault / AWS Secrets Manager / etc.
- Retrieves org X's broker TLS credentials
- Establishes MQTT connection
- Caches in memory (with a TTL) or discards after use

**Pros**:
- No long-term credential storage in the daemon
- Credential rotation is handled centrally
- The daemon only has access to credentials for orgs that are actively connecting

**Cons**:
- Latency on first connection per org (cold start)
- Dependencies: secrets store must be available at connection time
- Rate limits on the secrets store can become a bottleneck

### 4.4 Vault PKI (Dynamic Certificates per Org)

Instead of storing static certs, use Vault's PKI secrets engine to issue short-lived certificates per org on-demand:
- Each org has a Vault role defining allowed CNs, TTL, etc.
- The daemon authenticates to Vault with its own identity
- Requests a client certificate for the org: `vault write pki/issue/<org-role> common_name=<org-id>.broker.example.com`
- Receives a cert with TTL of hours/days
- Uses it for the MQTT mTLS connection
- When it expires, issue a new one

**Evidence**: "Vault PKI secrets engine enables Vault to act as a certificate authority (CA), allowing it to issue, manage, and revoke digital certificates. Applications request certificates via Vault's API, specifying the common name and SANs." ([QCEcuring, "HashiCorp Vault and PKI"](https://www.qcecuring.com/education/devsecops/hashicorp-vault-and-pki))

### Recommendation for Multi-Org MQTT Daemon

```
Scenario                              | Recommended Pattern
--------------------------------------|---------------------
<10 orgs, low churn, simple infra     | Envelope encryption with 1 KEK + per-org DEK
10-100 orgs, moderate scale           | JIT fetch from Vault Secrets or AWS Secrets Manager
100+ orgs, or high compliance needs   | Vault PKI dynamic certs (short-lived, no storage)
Existing Vault deployment             | Vault PKI + Vault Agent sidecar for bootstrapping
AWS-native, no existing PKI           | ACM Private CA + IAM Roles Anywhere + Secrets Manager
```

---

## 5. Persistence of Retention Buffers — Encryption-at-Rest

If the daemon persists MQTT message payloads to disk (retention buffers, offline queues, replay buffers), those payloads may contain sensitive data and should be encrypted at rest.

### 5.1 Docker Volume-Level Encryption (dm-crypt/LUKS)

For Docker volumes backed by a block device on the host, use dm-crypt with LUKS to encrypt the entire volume.

```bash
# Create an encrypted filesystem for the retention buffer volume
cryptsetup luksFormat /dev/xvdf
cryptsetup open /dev/xvdf retention-vol
mkfs.ext4 /dev/mapper/retention-vol
mount /dev/mapper/retention-vol /var/lib/docker/volumes/retention
```

**Docker Compose with LUKS**: Mount the decrypted volume as a Docker volume. The encryption/decryption is transparent to the container.

**Evidence**: "LUKS (Linux Unified Key Setup) is the standard for disk encryption on Linux. It encrypts the entire block device, protecting all data including filesystem structures, file metadata, and free space." ([oneuptime, "Configure dm-crypt and LUKS"](https://oneuptime.com/blog/post/2026-03-02-configure-dm-crypt-luks-block-device-encryption-ubuntu/))

### 5.2 Docker Secrets (Swarm-mode tmpfs)

Docker Secrets mount on a `tmpfs` RAM-backed filesystem. For retention buffers that only need short-lived persistence within the container's lifetime, this provides encryption of data at rest on the host (the data exists only in RAM).

**Limitation**: Not suitable for long-term persistence (data lost on container restart).

### 5.3 Application-Level Encryption

The daemon encrypts payloads before writing to disk, using per-tenant or per-message keys.

**Pattern**:
- Each retention buffer entry is encrypted with AES-256-GCM
- The encryption key is derived from a tenant-specific DEK (see Section 4.2)
- The DEK is stored separately (envelope encryption with KMS)
- Metadata (IV, key ID, tenant ID) is stored alongside the ciphertext

```go
type EncryptedRecord struct {
    TenantID      string `json:"tenant_id"`
    KeyID         string `json:"key_id"`       // Which KMS key wraps this
    CiphertextBlob []byte `json:"ct_blob"`     // Wrapped DEK from KMS
    IV             []byte `json:"iv"`
    Ciphertext     []byte `json:"ciphertext"`  // AES-GCM encrypted payload
}
```

**Pros**: 
- Granular encryption per-tenant per-record
- No dependency on host-level encryption
- Portable across storage backends

**Cons**:
- Key management complexity
- Cannot grep/search ciphertext
- Performance overhead per write/read

### 5.4 Storage Backend Encryption

If the daemon stores buffers in a database or object store:
- **PostgreSQL**: `pgcrypto` extension for column-level encryption, or TDE (Transparent Data Encryption) at the storage layer
- **S3**: Server-Side Encryption (SSE-S3, SSE-KMS, or SSE-C) — SSE-KMS with a per-bucket or per-prefix key is recommended for multi-tenant isolation
- **Local filesystem tmpfs + periodic snapshot**: Encrypted tmpfs snapshotted to encrypted EBS/volume

### 5.5 Host-Level Full Disk Encryption

In production, the container host itself should have full disk encryption (e.g., LUKS on the root volume, encrypted EBS on AWS). This provides a baseline defense-in-depth layer. Docker volumes inherit this protection at rest, but volumes may still be readable from a running container.

### Recommendation for Retention Buffers

| Scenario | Recommendation |
|----------|---------------|
| Single-host, low compliance | Host-level FDE (LUKS on host) |
| Multi-host, moderate compliance | dm-crypt/LUKS on dedicated volume + host FDE |
| High compliance (SOC2, PCI) | Application-level encryption (per-record AES-GCM) + KMS envelope |
| Multi-tenant isolation required | Per-tenant DEKs, envelope encryption, separate ciphertext prefixes |
| Short-lived buffers only | tmpfs-based volume (no disk persistence) |

---

## 6. Design Recommendations for the MQTT Daemon

### Recommended Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Containerized MQTT Daemon                     │
│                                                                      │
│  ┌──────────┐   ┌────────────────────┐   ┌────────────────────────┐ │
│  │ Bootstrap │   │  TLS Identity      │   │  Retention Buffer      │ │
│  │ Phase:    │──▶│  (cert/key loaded  │   │  (AES-GCM encrypted    │ │
│  │ 1. Vault  │   │   via GetCert      │   │   per record, per-org  │ │
│  │    Auth   │   │   callback)        │   │   DEK from KMS)        │ │
│  │ 2. Fetch  │   └────────────────────┘   └────────────────────────┘ │
│  │    PKI    │                                                       │
│  │ 3. Memory │   ┌────────────────────┐   ┌────────────────────────┐ │
│  │    only   │   │  Per-Org Broker    │   │  Inbound TLS (device   │ │
│  └──────────┘   │  mTLS Credentials   │   │  connections)          │ │
│                  │  (JIT fetch from   │   │  - Server cert: cert-  │ │
│  ┌──────────┐   │   Vault/KMS env.   │   │    manager managed      │ │
│  │ Hot-     │   │   envelope enc.)   │   │  - Client mTLS: device  │ │
│  │ Reload:  │   └────────────────────┘   │    certs → org mapping  │ │
│  │ fsnotify │                            └────────────────────────┘ │
│  │ + atomic │                                                       │
│  └──────────┘                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Decisions

1. **Bootstrap**: Use Vault Agent sidecar or cert-manager (K8s) / Vault PKI (non-K8s). Never bake certs into the image.
2. **Rotation**: Implement `GetCertificate` callback in Go for zero-downtime server cert rotation. For client certs, use a `GetClientCertificate` callback that re-reads per-org credentials. Add `fsnotify` watching for proactive reload.
3. **Multi-tenant**: mTLS-per-org for outbound broker connections (strongest isolation). Single server cert for inbound device connections with device-client-cert → org mapping via CN or custom SAN.
4. **Credential storage**: KMS envelope encryption with one DEK per org. Store the envelope (wrapped DEK + ciphertext) in a database or config file. Unwrap on demand.
5. **Persistence**: Application-level AES-256-GCM per-record encryption with per-tenant DEKs for the retention buffer. Combined with host-level FDE for defense-in-depth.

---

## Sources

1. Docker Secrets. Docker Inc. [https://docs.docker.com/engine/swarm/secrets/](https://docs.docker.com/engine/swarm/secrets/)
2. Vault Agent Injector. HashiCorp. [https://developer.hashicorp.com/vault/docs/deploy/kubernetes/injector](https://developer.hashicorp.com/vault/docs/deploy/kubernetes/injector)
3. AWS IAM Roles Anywhere. AWS. [https://aws.amazon.com/iam/roles-anywhere/](https://aws.amazon.com/iam/roles-anywhere/)
4. cert-manager Installation Guide. [https://cert-manager.io/](https://cert-manager.io/)
5. "Best Certificate Management Tools in 2026". Infisical. [https://infisical.com/blog/best-certificate-management-tools](https://infisical.com/blog/best-certificate-management-tools)
6. "Zero downtime Certificate rotation for Go applications". Nikunj Rathi. [https://medium.com/@rathinikunj/zero-downtime-certificate-rotation-for-go-applications-a946b91cb83c](https://medium.com/@rathinikunj/zero-downtime-certificate-rotation-for-go-applications-a946b91cb83c)
7. dyson/certman: Go TLS hot-reload. GitHub. [https://github.com/dyson/certman](https://github.com/dyson/certman)
8. "Hitless TLS Certificate Rotation in Go". Diogo Mónica (Docker). [https://blog.diogomonica.com/2017/01/11/hitless-tls-certificate-rotation-in-go/](https://blog.diogomonica.com/2017/01/11/hitless-tls-certificate-rotation-in-go/)
9. "Envelope encryption". Google Cloud KMS docs. [https://docs.cloud.google.com/kms/docs/envelope-encryption](https://docs.cloud.google.com/kms/docs/envelope-encryption)
10. "Simplify multi-tenant encryption with a cost-conscious AWS KMS key strategy". AWS Architecture Blog. [https://aws.amazon.com/blogs/architecture/simplify-multi-tenant-encryption-with-a-cost-conscious-aws-kms-key-strategy/](https://aws.amazon.com/blogs/architecture/simplify-multi-tenant-encryption-with-a-cost-conscious-aws-kms-key-strategy/)
11. "JWKS and Zero-Downtime Key Rotation". David Sulc. [https://www.davidsulc.com/blog/jws-apis-jwks-basics](https://www.davidsulc.com/blog/jws-apis-jwks-basics)
12. ChirpStack Mosquitto TLS configuration. [https://www.chirpstack.io/docs/guides/mosquitto-tls-configuration.html](https://www.chirpstack.io/docs/guides/mosquitto-tls-configuration.html)
13. "Comparison of Open Source MQTT Brokers 2025". EMQ. [https://www.emqx.com/en/blog/a-comprehensive-comparison-of-open-source-mqtt-brokers-in-2023](https://www.emqx.com/en/blog/a-comprehensive-comparison-of-open-source-mqtt-brokers-in-2023)
14. dm-crypt device encryption. ArchWiki. [https://wiki.archlinux.org/title/Dm-crypt/Device_encryption](https://wiki.archlinux.org/title/Dm-crypt/Device_encryption)
15. "How to Handle Secrets in Docker". GitGuardian. [https://blog.gitguardian.com/how-to-handle-secrets-in-docker/](https://blog.gitguardian.com/how-to-handle-secrets-in-docker/)
16. "HashiCorp Vault and PKI — Using Vault as a Certificate Authority". QCEcuring. [https://www.qcecuring.com/education/devsecops/hashicorp-vault-and-pki](https://www.qcecuring.com/education/devsecops/hashicorp-vault-and-pki)
17. "Envelope Encryption with AWS KMS in Go". Shaswat Shah. [https://medium.com/@shaswatshah_69916/envelope-encryption-with-aws-kms-in-go-the-secure-way-to-scale-encryption-0540c874cebf](https://medium.com/@shaswatshah_69916/envelope-encryption-with-aws-kms-in-go-the-secure-way-to-scale-encryption-0540c874cebf)
18. Kueue issue #9005: Metrics TLS secret not hot-reloaded. [https://github.com/kubernetes-sigs/kueue/issues/9005](https://github.com/kubernetes-sigs/kueue/issues/9005)
19. Go proposal: dynamically reload root CAs. golang/go#64796. [https://github.com/golang/go/issues/64796](https://github.com/golang/go/issues/64796)
20. "Docker Secrets explained: setup, best practices & examples". Wiz Academy. [https://www.wiz.io/academy/container-security/docker-secrets](https://www.wiz.io/academy/container-security/docker-secrets)
21. "IAM Roles Anywhere with open-source private CA". Paul Schwarzenberger. [https://medium.com/@paulschwarzenberger/aws-iam-roles-anywhere-with-open-source-private-ca-6c0ec5758b2b](https://medium.com/@paulschwarzenberger/aws-iam-roles-anywhere-with-open-source-private-ca-6c0ec5758b2b)
22. HashiCorp Vault PKI secrets engine. [https://developer.hashicorp.com/vault/docs/secrets/pki](https://developer.hashicorp.com/vault/docs/secrets/pki)
23. "Automate Certificates with Vault PKI". Traefik Hub Docs. [https://doc.traefik.io/traefik-hub/api-gateway/secure/tls/vault-pki](https://doc.traefik.io/traefik-hub/api-gateway/secure/tls/vault-pki)
24. "Dynamically update TLS certificates in a Golang server without downtime". Savita Ashture, Opensource.com. [https://opensource.com/article/22/9/dynamically-update-tls-certificates-golang-server-no-downtime](https://opensource.com/article/22/9/dynamically-update-tls-certificates-golang-server-no-downtime)
25. Kubernetes client-go CA rotation issue. kubernetes/kubernetes#119483. [https://github.com/kubernetes/kubernetes/issues/119483](https://github.com/kubernetes/kubernetes/issues/119483)

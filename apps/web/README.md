# controlai-web

## Gateway Board Provisioning

The web app can provision STM32-based modules boards directly from the browser
over USB-CDC using the Web Serial API. No external tooling required.

### Prerequisites
- Desktop **Chrome or Edge** (Web Serial is Chromium-only)
- Served over **HTTPS** (or `localhost` for development)
- STM32 USB-CDC driver installed (auto on macOS / Windows 10+)
- Gateway in controlai-web has all three PEMs issued (auto via daemon PKI, or
  manual via the dialog's "cert 수동 입력 (고급)" accordion)

### Operator quick-start
1. Navigate to a Gateway: **Project → Site Group → Gateway**
2. Click **보드에 설치**
3. Click **포트 선택 및 셋업 시작** and pick the board's serial port
4. Wait for the step checklist to tick through to **완료**

### Troubleshooting
- **Port not in picker** → check USB cable / driver, confirm board powered.
- **Probe times out** → the page auto-issues `boot` to exit bootloader mode.
- **"Cert stored" missing** → cert may be too large for one chunk; retry will
  re-send all chunks fresh.
- **Failure banner** → click **재시도**, re-pick the port (Web Serial requires
  fresh user gesture on each session).

See `openspec/specs/gateway-board-provisioning/` for the capability spec.

## Instances

ControlAI supports two ways to attach a daemon to your organization:

- **BYO (Register existing)** — Run and manage the daemon on your own infrastructure (on-prem, air-gapped, custom setup). See [Instance BYO vs Managed](../../docs/instance-byo-vs-managed.md).
- **Auto-provisioned (Managed)** — ControlAI provisions and manages the daemon for you with one click. See [Instance Provisioning](../../docs/instance-provisioning.md).

## Canvas catalog

See `docs/device-type-authoring.md` for manifest authoring.

`listDeviceTypes()` returns the registered canvas catalog. To add a new device,
add a manifest file under
`packages/shared-types/src/device-types/manifests/<vendor>/<id>.ts`.

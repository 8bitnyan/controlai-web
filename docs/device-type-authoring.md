## Device type authoring

Register new manifests in `@controlai-web/shared-types` with `registerDeviceType(...)`.

```ts
import { registerDeviceType } from '../../registry';

registerDeviceType({
  id: 'vendor-device-id',
  category: 'sensor',
  displayName: 'Vendor Sensor',
  manufacturer: 'Vendor',
  model: 'VS-1000',
  version: '1.0.0',
  iconRef: 'Gauge',
  accentColor: '#3B82F6',
  firmwareTypeIds: ['vendor.sensor.v1'],
  ports: [{ id: 'out', direction: 'out', portType: 'mqtt-topic', maxCount: 1 }],
  defaultSignal: { format: 'json', rateMs: 1000 },
  constraints: { minIntervalMs: 100 },
});
```

### Validation expectations by category

- `sensor`: must define `defaultSignal`; ports must be `direction: 'out'`.
- `gateway`: must include at least one `rs485-bus` or `mqtt-topic` port.
- `broker`: must include exactly one `mqtt-topic` port; must not define `defaultSignal`.
- `ingest`, `tsdb`, `monitoring`: must have no ports and no `defaultSignal`.

### Icon + accent conventions

- `iconRef` should map to a Lucide icon name used by the UI.
- `accentColor` must be a hex string (`#RGB` or `#RRGGBB`).

### Checklist for adding a manifest

1. Create a manifest file under `packages/shared-types/src/device-types/manifests/<vendor>/<id>.ts`.
2. Register it with `registerDeviceType(...)`.
3. Add a side-effect import in `packages/shared-types/src/device-types/index.ts`.
4. Keep imports in alphabetical order.
5. Run tests; aggregator contract tests fail when a manifest file exists but is not imported.

### Declaring `firmwareTypeIds` for register-time discoverability

During gateway registration, the backend reads each discovered child's firmware-reported
type code and tries to match it against manifest `firmwareTypeIds[]` entries.
If a manifest claims that code, it becomes a candidate for auto-match and confidence scoring.

Use stable, firmware-facing identifiers in this array. Keep entries explicit and scoped
to the exact device family the firmware emits.

```ts
registerDeviceType({
  id: 'daejak-vm',
  category: 'sensor',
  displayName: 'DAEJAK VM',
  manufacturer: 'DAEJAK',
  model: 'VM',
  version: '1.0.0',
  iconRef: 'Gauge',
  accentColor: '#2563EB',
  firmwareTypeIds: ['DAEJAK_VM'],
  ports: [{ id: 'out', direction: 'out', portType: 'mqtt-topic', maxCount: 1 }],
  defaultSignal: { format: 'json', rateMs: 1000 },
  constraints: { minIntervalMs: 100 },
});
```

#### Multi-claim warning behavior

If multiple manifests claim the same firmware type code, registration emits a warning.
Selection is deterministic: the manifest with the lexicographically lowest manifest `id`
wins the tie.

That fallback prevents nondeterministic matching, but it should be treated as a config
smell. Resolve multi-claims by making `firmwareTypeIds[]` ownership unambiguous.

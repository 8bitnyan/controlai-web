# Authoring a Broker Driver

ControlAI brokers ingest messages via a pluggable **BrokerDriver** registry.
This is the v1 contract; future drivers (Pulsar, NATS, Mosquitto direct, etc.)
follow the same pattern.

## Folder layout

```
packages/runtime-drivers/
  src/                # core schema + registry + topic-translator + normalized message
  drivers/
    mqtt-driver/      # MQTT (mqtt.js)
    kafka-driver/     # Kafka (kafkajs)
    http-webhook-driver/  # HTTP POST + HMAC
    tsdb-direct-driver/   # Direct TimescaleDB writes (not a transport)
    index.ts          # side-effect aggregator — imports every driver
```

## Add a new driver

1. Create `packages/runtime-drivers/drivers/<your-driver-id>/index.ts`.
2. Inside, define a Zod schema for runtime config:
   ```ts
   import { z } from 'zod';
   export const YourDriverConfigSchema = z.object({ /* ... */ });
   ```
3. Implement `factory(config) => BrokerDriverInstance` returning an object with
   `connect / subscribe / publish / healthCheck / validateConfig / close`.
4. Call `registerBrokerDriver(...)` at module scope:
   ```ts
   registerBrokerDriver({
     id: 'your-driver-id',                       // lowercase, dash-separated
     displayName: 'Your Driver',
     supportedSiteCapabilities: ['mqtt-ingest'], // or kafka-ingest, http-webhook, tsdb-direct
     configSchema: YourDriverConfigSchema,
     factory: createYourDriverInstance,
   });
   ```
5. Add a side-effect import to
   `packages/runtime-drivers/drivers/index.ts` — `import './your-driver-id';`.
6. Add tests under `packages/runtime-drivers/drivers/<your-driver-id>/__tests__/`.

## Constraints

- IDs MUST match `/^[a-z][a-z0-9-]*$/`.
- `configSchema` MUST be a Zod schema (validated at registration time).
- `publish()` MAY throw a sentinel error when the driver is read-only (e.g.
  `kafka-driver` and `http-webhook-driver` both throw on publish).
- `validateConfig(cfg)` MUST return `{ ok: true } | { ok: false, errors: string[] }`.
- Subscribe-side handlers receive `NormalizedMessage`
  (`{ deviceKey, dataType, payload, ts, sourceTopic?, sourceDriver }`).

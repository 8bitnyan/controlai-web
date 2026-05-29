# Research references — add-plugin-device-type-registry

## Saved research documents

- `.slash/workspace/research/device-type-registry-prior-art.md` — covers ThingsBoard Device Profiles, Home Assistant Integration Manifest, Node-RED `registerType()`, AWS IoT Thing Types, Azure DTDL `maxMultiplicity`, KNX DPT topology, BACnet BIBB profiles. Recommends in-repo TS module registry with Zod (Option A); cites Matter.js's `DeviceTypeRegistry` as the working reference.
- `.slash/workspace/research/canvas-library-comparison.md` — confirms `@xyflow/react` v12.10.2 (already in the project) is the right canvas library; documents the `isValidConnection` prop pattern used here.

## Key external references

- DTDL Relationship `maxMultiplicity` spec — `https://learn.microsoft.com/en-us/azure/digital-twins/concepts-models#relationships`. We borrow the *concept* (per-relationship capacity) without taking the JSON-LD toolchain.
- Matter.js `DeviceTypeRegistry` — `https://github.com/project-chip/matter.js`. Closest working analog for our in-process registry shape.
- Zod docs — `https://zod.dev`. Schema, refinements, type inference.
- xyflow `isValidConnection` API — `https://reactflow.dev/api-reference/types/is-valid-connection`.

## Internal references

- Existing `openspec/specs/gateway-board-provisioning/spec.md` — context for the firmware-side reality this catalog must model.
- `packages/shared-types/src/node-types.ts` — the current static enum / Zod-union being replaced.
- `packages/shared-types/src/connection-rules.ts` — the current `CONNECTION_MATRIX` being removed.
- `apps/web/components/canvas/node-palette.tsx` — current palette implementation being rewritten in tasks 7.1.
- `apps/web/components/canvas/canvas.tsx` — receives the new `isValidConnection` wire-up in tasks 7.2.

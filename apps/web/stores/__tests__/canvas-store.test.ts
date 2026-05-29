import { beforeEach, describe, expect, it } from 'vitest';
import { useCanvasStore, type DeviceRow } from '../canvas-store';

const makeDevice = (overrides: Partial<DeviceRow> = {}): DeviceRow => ({
  deviceKey: 'dev_1',
  deviceTypeId: 'core-generic-sensor',
  registrationState: 'UNREGISTERED',
  shadowUuid: 'shadow_1',
  simulationDesired: true,
  config: {},
  ...overrides,
});

describe('canvas-store nodeDevices', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodeDevices: new Map() });
  });

  it('setNodeDevice + getDeviceByCanvasNodeId round-trip', () => {
    const device = makeDevice();
    useCanvasStore.getState().setNodeDevice('node-1', device);

    expect(useCanvasStore.getState().getDeviceByCanvasNodeId('node-1')).toEqual(device);
  });

  it('removeNodeDevice clears device', () => {
    useCanvasStore.getState().setNodeDevice('node-1', makeDevice());
    useCanvasStore.getState().removeNodeDevice('node-1');

    expect(useCanvasStore.getState().getDeviceByCanvasNodeId('node-1')).toBeUndefined();
  });

  it('bulkSetNodeDevices replaces previous map', () => {
    useCanvasStore.getState().setNodeDevice('old-node', makeDevice({ deviceKey: 'old' }));

    useCanvasStore.getState().bulkSetNodeDevices([
      { canvasNodeId: 'node-1', device: makeDevice({ deviceKey: 'dev_1' }) },
      { canvasNodeId: 'node-2', device: makeDevice({ deviceKey: 'dev_2' }) },
    ]);

    expect(useCanvasStore.getState().nodeDevices.size).toBe(2);
    expect(useCanvasStore.getState().getDeviceByCanvasNodeId('old-node')).toBeUndefined();
    expect(useCanvasStore.getState().getDeviceByCanvasNodeId('node-1')?.deviceKey).toBe('dev_1');
    expect(useCanvasStore.getState().getDeviceByCanvasNodeId('node-2')?.deviceKey).toBe('dev_2');
  });

  it('getDevicesBySimulationDesired classifies all-true/all-false/mixed', () => {
    useCanvasStore
      .getState()
      .bulkSetNodeDevices([
        { canvasNodeId: 'a', device: makeDevice({ simulationDesired: true }) },
        { canvasNodeId: 'b', device: makeDevice({ deviceKey: 'dev_2', simulationDesired: true }) },
      ]);

    expect(useCanvasStore.getState().getDevicesBySimulationDesired()).toEqual({
      allDesired: true,
      allNotDesired: false,
      mixed: false,
    });

    useCanvasStore
      .getState()
      .bulkSetNodeDevices([
        { canvasNodeId: 'a', device: makeDevice({ simulationDesired: false }) },
        {
          canvasNodeId: 'b',
          device: makeDevice({ deviceKey: 'dev_2', simulationDesired: false }),
        },
      ]);

    expect(useCanvasStore.getState().getDevicesBySimulationDesired()).toEqual({
      allDesired: false,
      allNotDesired: true,
      mixed: false,
    });

    useCanvasStore
      .getState()
      .bulkSetNodeDevices([
        { canvasNodeId: 'a', device: makeDevice({ simulationDesired: true }) },
        {
          canvasNodeId: 'b',
          device: makeDevice({ deviceKey: 'dev_2', simulationDesired: false }),
        },
      ]);

    expect(useCanvasStore.getState().getDevicesBySimulationDesired()).toEqual({
      allDesired: false,
      allNotDesired: false,
      mixed: true,
    });
  });
});

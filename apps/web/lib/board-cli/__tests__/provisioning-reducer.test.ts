import { describe, expect, it } from 'vitest';

import {
  INITIAL_STATE,
  type ProvisioningAction,
  provisioningReducer,
  type ProvisioningState,
} from '../provisioning-reducer';

function reduce(actions: ProvisioningAction[], initialState: ProvisioningState = INITIAL_STATE) {
  return actions.reduce(provisioningReducer, initialState);
}

describe('provisioningReducer', () => {
  it('handles happy path to DONE and tracks completed send steps', () => {
    const state = reduce([
      { type: 'START_REQUESTING_PORT' },
      { type: 'PORT_ACQUIRED' },
      { type: 'PORT_OPENED' },
      { type: 'PROBE_SUCCEEDED' },
      { type: 'DEVICE_INFO_READ', deviceSerial: 'GW-001' },
      { type: 'ITEM_STARTED', step: 'SENDING_GROUP_ID' },
      { type: 'ITEM_COMPLETED', step: 'SENDING_GROUP_ID' },
      { type: 'ITEM_STARTED', step: 'SENDING_BROKER' },
      { type: 'ITEM_COMPLETED', step: 'SENDING_BROKER' },
      { type: 'ITEM_STARTED', step: 'SENDING_CERTCA' },
      { type: 'ITEM_COMPLETED', step: 'SENDING_CERTCA' },
      { type: 'ITEM_STARTED', step: 'SENDING_CERTCLIENT' },
      { type: 'ITEM_COMPLETED', step: 'SENDING_CERTCLIENT' },
      { type: 'ITEM_STARTED', step: 'SENDING_CERTKEY' },
      { type: 'ITEM_COMPLETED', step: 'SENDING_CERTKEY' },
      { type: 'REBOOT_SENT' },
    ]);

    expect(state.step).toBe('DONE');
    expect(state.completedSteps).toEqual([
      'SENDING_GROUP_ID',
      'SENDING_BROKER',
      'SENDING_CERTCA',
      'SENDING_CERTCLIENT',
      'SENDING_CERTKEY',
    ]);
  });

  it('handles bootloader path when probe times out', () => {
    const state = reduce([
      { type: 'START_REQUESTING_PORT' },
      { type: 'PORT_ACQUIRED' },
      { type: 'PORT_OPENED' },
      { type: 'PROBE_TIMED_OUT_NEEDS_BOOT' },
      { type: 'BOOT_COMPLETED' },
    ]);

    expect(state.step).toBe('READING_DEVICE_INFO');
  });

  it('moves to ERROR with correct failure metadata', () => {
    const steps = ['OPENING_PORT', 'PROBING', 'SENDING_GROUP_ID', 'REBOOTING'] as const;

    for (const step of steps) {
      const state = reduce([{ type: 'STEP_FAILED', step, reason: `failed at ${step}` }]);
      expect(state.step).toBe('ERROR');
      expect(state.failure).toEqual({ step, reason: `failed at ${step}` });
    }
  });

  it('resets to INITIAL_STATE from non-initial state', () => {
    const dirty = reduce([
      { type: 'START_REQUESTING_PORT' },
      { type: 'PORT_ACQUIRED' },
      { type: 'CONSOLE_LINE_APPENDED', line: 'line 1' },
      { type: 'STEP_FAILED', step: 'OPENING_PORT', reason: 'boom' },
    ]);

    const reset = provisioningReducer(dirty, { type: 'RESET' });
    expect(reset).toEqual(INITIAL_STATE);
  });

  it('accumulates console lines and caps at last 500', () => {
    let state = INITIAL_STATE;
    for (let i = 1; i <= 550; i++) {
      state = provisioningReducer(state, { type: 'CONSOLE_LINE_APPENDED', line: `line-${i}` });
    }

    expect(state.consoleLines).toHaveLength(500);
    expect(state.consoleLines[0]).toBe('line-51');
    expect(state.consoleLines[499]).toBe('line-550');
  });
});

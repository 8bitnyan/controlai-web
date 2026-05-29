import { describe, expect, it } from 'vitest';

import { INITIAL_STATE, registerReducer, type RegisterState } from '../register-reducer';

const parsedStatus = { gatewayUuid: 'gw-1' };
const matchPlan = { matches: [{ key: 'd1' }] };
const decisions = { confirmed: ['d1'] };
const error = { message: 'boom' };

describe('registerReducer', () => {
  it('has INITIAL_STATE as IDLE', () => {
    expect(INITIAL_STATE).toEqual({ phase: 'IDLE' });
  });

  it('transitions IDLE -> CONNECTING on START', () => {
    expect(registerReducer({ phase: 'IDLE' }, { type: 'START' })).toEqual({ phase: 'CONNECTING' });
  });

  it('transitions CONNECTING -> READING_STATUS on PORT_OPENED', () => {
    expect(registerReducer({ phase: 'CONNECTING' }, { type: 'PORT_OPENED' })).toEqual({ phase: 'READING_STATUS' });
  });

  it('transitions READING_STATUS -> PROPOSING with parsedStatus', () => {
    expect(registerReducer({ phase: 'READING_STATUS' }, { type: 'STATUS_READ', parsedStatus })).toEqual({
      phase: 'PROPOSING',
      parsedStatus,
    });
  });

  it('transitions PROPOSING -> AWAITING_USER_DECISION with payload carry-through', () => {
    const state: RegisterState = { phase: 'PROPOSING', parsedStatus };
    expect(registerReducer(state, { type: 'PROPOSAL_RECEIVED', registrationSessionId: 'rs-1', matchPlan })).toEqual({
      phase: 'AWAITING_USER_DECISION',
      registrationSessionId: 'rs-1',
      parsedStatus,
      matchPlan,
    });
  });

  it('transitions AWAITING_USER_DECISION -> COMMITTING with decision payload', () => {
    const state: RegisterState = {
      phase: 'AWAITING_USER_DECISION',
      registrationSessionId: 'rs-1',
      parsedStatus,
      matchPlan,
    };
    expect(registerReducer(state, { type: 'USER_DECIDED', decisions })).toEqual({
      phase: 'COMMITTING',
      registrationSessionId: 'rs-1',
      parsedStatus,
      matchPlan,
      decisions,
    });
  });

  it('transitions COMMITTING -> DONE and preserves all payload', () => {
    const state: RegisterState = {
      phase: 'COMMITTING',
      registrationSessionId: 'rs-1',
      parsedStatus,
      matchPlan,
      decisions,
    };
    expect(registerReducer(state, { type: 'COMMIT_SUCCESS' })).toEqual({
      phase: 'DONE',
      registrationSessionId: 'rs-1',
      parsedStatus,
      matchPlan,
      decisions,
    });
  });

  it('COMMIT_FAILED moves to FAILED with error payload', () => {
    const state: RegisterState = { phase: 'COMMITTING', registrationSessionId: 'rs-1', parsedStatus, matchPlan, decisions };
    expect(registerReducer(state, { type: 'COMMIT_FAILED', error })).toEqual({ phase: 'FAILED', error });
  });

  it('FAIL from any state moves to FAILED', () => {
    expect(registerReducer({ phase: 'READING_STATUS' }, { type: 'FAIL', error })).toEqual({ phase: 'FAILED', error });
  });

  it('ABORT from non-DONE moves to ABORTED', () => {
    expect(registerReducer({ phase: 'CONNECTING' }, { type: 'ABORT' })).toEqual({ phase: 'ABORTED' });
  });

  it('ABORT from DONE is ignored', () => {
    const state: RegisterState = {
      phase: 'DONE',
      registrationSessionId: 'rs-1',
      parsedStatus,
      matchPlan,
      decisions,
    };
    expect(registerReducer(state, { type: 'ABORT' })).toBe(state);
  });

  it('invalid action for current phase is a no-op', () => {
    const state: RegisterState = { phase: 'IDLE' };
    expect(registerReducer(state, { type: 'PORT_OPENED' })).toBe(state);
  });
});

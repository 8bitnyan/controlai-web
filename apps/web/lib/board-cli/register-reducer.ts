export type RegisterPhase =
  | 'IDLE'
  | 'CONNECTING'
  | 'READING_STATUS'
  | 'PROPOSING'
  | 'AWAITING_USER_DECISION'
  | 'COMMITTING'
  | 'DONE'
  | 'FAILED'
  | 'ABORTED';

export type RegisterError = {
  message: string;
};

type StateIdle = { phase: 'IDLE' };
type StateConnecting = { phase: 'CONNECTING' };
type StateReadingStatus = { phase: 'READING_STATUS' };
type StateProposing = {
  phase: 'PROPOSING';
  parsedStatus: unknown;
};
type StateAwaitingDecision = {
  phase: 'AWAITING_USER_DECISION';
  registrationSessionId: string;
  parsedStatus: unknown;
  matchPlan: unknown;
};
type StateCommitting = {
  phase: 'COMMITTING';
  registrationSessionId: string;
  parsedStatus: unknown;
  matchPlan: unknown;
  decisions: unknown;
};
type StateDone = {
  phase: 'DONE';
  registrationSessionId: string;
  parsedStatus: unknown;
  matchPlan: unknown;
  decisions: unknown;
};
type StateFailed = {
  phase: 'FAILED';
  error: RegisterError;
};
type StateAborted = {
  phase: 'ABORTED';
};

export type RegisterState =
  | StateIdle
  | StateConnecting
  | StateReadingStatus
  | StateProposing
  | StateAwaitingDecision
  | StateCommitting
  | StateDone
  | StateFailed
  | StateAborted;

export type RegisterAction =
  | { type: 'START' }
  | { type: 'PORT_OPENED' }
  | { type: 'STATUS_READ'; parsedStatus: unknown }
  | { type: 'PROPOSAL_RECEIVED'; registrationSessionId: string; matchPlan: unknown }
  | { type: 'USER_DECIDED'; decisions: unknown }
  | { type: 'COMMIT_SUCCESS' }
  | { type: 'COMMIT_FAILED'; error: RegisterError }
  | { type: 'FAIL'; error: RegisterError }
  | { type: 'ABORT' };

export const INITIAL_STATE: RegisterState = { phase: 'IDLE' };

export function registerReducer(state: RegisterState, action: RegisterAction): RegisterState {
  if (action.type === 'ABORT' && state.phase !== 'DONE') {
    return { phase: 'ABORTED' };
  }

  if (action.type === 'FAIL') {
    return { phase: 'FAILED', error: action.error };
  }

  if (action.type === 'COMMIT_FAILED') {
    return { phase: 'FAILED', error: action.error };
  }

  switch (state.phase) {
    case 'IDLE':
      if (action.type === 'START') return { phase: 'CONNECTING' };
      return state;
    case 'CONNECTING':
      if (action.type === 'PORT_OPENED') return { phase: 'READING_STATUS' };
      return state;
    case 'READING_STATUS':
      if (action.type === 'STATUS_READ') {
        return { phase: 'PROPOSING', parsedStatus: action.parsedStatus };
      }
      return state;
    case 'PROPOSING':
      if (action.type === 'PROPOSAL_RECEIVED') {
        return {
          phase: 'AWAITING_USER_DECISION',
          registrationSessionId: action.registrationSessionId,
          parsedStatus: state.parsedStatus,
          matchPlan: action.matchPlan,
        };
      }
      return state;
    case 'AWAITING_USER_DECISION':
      if (action.type === 'USER_DECIDED') {
        return {
          phase: 'COMMITTING',
          registrationSessionId: state.registrationSessionId,
          parsedStatus: state.parsedStatus,
          matchPlan: state.matchPlan,
          decisions: action.decisions,
        };
      }
      return state;
    case 'COMMITTING':
      if (action.type === 'COMMIT_SUCCESS') {
        return {
          phase: 'DONE',
          registrationSessionId: state.registrationSessionId,
          parsedStatus: state.parsedStatus,
          matchPlan: state.matchPlan,
          decisions: state.decisions,
        };
      }
      return state;
    case 'DONE':
      return state;
    case 'FAILED':
      return state;
    case 'ABORTED':
      return state;
    default:
      return state;
  }
}

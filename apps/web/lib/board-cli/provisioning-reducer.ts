export type ProvisioningStep =
  | 'IDLE'
  | 'REQUESTING_PORT'
  | 'OPENING_PORT'
  | 'PROBING'
  | 'BOOTING_APP'
  | 'READING_DEVICE_INFO'
  | 'SENDING_GROUP_ID'
  | 'SENDING_BROKER'
  | 'SENDING_CERTCA'
  | 'SENDING_CERTCLIENT'
  | 'SENDING_CERTKEY'
  | 'REBOOTING'
  | 'DONE'
  | 'ERROR';

export interface ProvisioningState {
  step: ProvisioningStep;
  deviceSerial?: string;
  chunkProgress?: { sent: number; total: number; itemId: string };
  consoleLines: string[];
  startedAt?: number;
  completedSteps: ProvisioningStep[];
  failure?: { step: ProvisioningStep; reason: string };
}

export type ProvisioningAction =
  | { type: 'START_REQUESTING_PORT' }
  | { type: 'PORT_ACQUIRED' }
  | { type: 'PORT_OPENED' }
  | { type: 'PROBE_SUCCEEDED' }
  | { type: 'PROBE_TIMED_OUT_NEEDS_BOOT' }
  | { type: 'BOOT_COMPLETED' }
  | { type: 'DEVICE_INFO_READ'; deviceSerial?: string }
  | { type: 'ITEM_STARTED'; step: ProvisioningStep }
  | { type: 'CHUNK_PROGRESS'; sent: number; total: number; itemId: string }
  | { type: 'ITEM_COMPLETED'; step: ProvisioningStep }
  | { type: 'REBOOT_SENT' }
  | { type: 'CONSOLE_LINE_APPENDED'; line: string }
  | { type: 'STEP_FAILED'; step: ProvisioningStep; reason: string }
  | { type: 'RESET' };

export const INITIAL_STATE: ProvisioningState = {
  step: 'IDLE',
  consoleLines: [],
  completedSteps: [],
};

export function provisioningReducer(
  state: ProvisioningState,
  action: ProvisioningAction,
): ProvisioningState {
  switch (action.type) {
    case 'START_REQUESTING_PORT':
      return {
        ...state,
        step: 'REQUESTING_PORT',
        startedAt: Date.now(),
        completedSteps: [],
        failure: undefined,
        consoleLines: [],
      };
    case 'PORT_ACQUIRED':
      return { ...state, step: 'OPENING_PORT' };
    case 'PORT_OPENED':
      return { ...state, step: 'PROBING' };
    case 'PROBE_SUCCEEDED':
      return { ...state, step: 'READING_DEVICE_INFO' };
    case 'PROBE_TIMED_OUT_NEEDS_BOOT':
      return { ...state, step: 'BOOTING_APP' };
    case 'BOOT_COMPLETED':
      return { ...state, step: 'READING_DEVICE_INFO' };
    case 'DEVICE_INFO_READ':
      return { ...state, deviceSerial: action.deviceSerial, step: 'SENDING_GROUP_ID' };
    case 'ITEM_STARTED':
      return { ...state, step: action.step, chunkProgress: undefined };
    case 'CHUNK_PROGRESS':
      return {
        ...state,
        chunkProgress: { sent: action.sent, total: action.total, itemId: action.itemId },
      };
    case 'ITEM_COMPLETED':
      return {
        ...state,
        chunkProgress: undefined,
        completedSteps: [...state.completedSteps, action.step],
      };
    case 'REBOOT_SENT':
      return { ...state, step: 'DONE', chunkProgress: undefined };
    case 'CONSOLE_LINE_APPENDED':
      return { ...state, consoleLines: [...state.consoleLines, action.line].slice(-500) };
    case 'STEP_FAILED':
      return {
        ...state,
        step: 'ERROR',
        failure: { step: action.step, reason: action.reason },
      };
    case 'RESET':
      return INITIAL_STATE;
    default:
      return state;
  }
}

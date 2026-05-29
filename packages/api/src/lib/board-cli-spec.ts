/**
 * Board CLI protocol spec for STM32 modules board provisioning.
 *
 * All constants here are tied to firmware behavior (verified against
 * Daejak_MAIN_APP/App/src/cli_commands.c). Changing any value here implies
 * a firmware change. Do NOT model these in the DB — keep as source.
 *
 * See openspec/changes/add-gateway-board-provisioning/ design D3.
 */

export const BOARD_SERIAL_OPTIONS = {
  baudRate: 115200,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  bufferSize: 16384,
  flowControl: 'none',
} as const;

export const BOARD_PROMPT_REGEX = /^CLI>\s*/;
export const BOARD_DEFAULT_FAILURE_REGEX = /\b(usage|error|invalid|fail|unknown)\b/i;
export const BOARD_CHUNKED_SUCCESS_REGEX =
  /Cert stored: \d+ bytes DER \(saved to flash\)\.|stored|saved|ok/i;
export const BOARD_LINE_ENDING = '\r\n';
export const BOARD_MAX_CHUNK_LINE_CHARS = 200;
/** Delay between successive hex chunk lines inside a chunked transfer. */
export const BOARD_INTER_CHUNK_DELAY_MS = 50;
/** Delay after a chunked-open command (e.g. `certca set`) before streaming the first hex line —
 *  gives firmware time to enter capture mode and allocate the receive buffer. */
export const BOARD_POST_CHUNK_OPEN_DELAY_MS = 200;
/** Delay after a chunked-close command (e.g. `certca end`) succeeds — lets the flash write commit
 *  before the next provisioning step runs. */
export const BOARD_POST_CHUNK_CLOSE_DELAY_MS = 300;
/** Delay between two distinct provisioning commands (group_id → broker → certca → ...).
 *  Prevents back-to-back input the firmware CLI may not fully drain between handlers. */
export const BOARD_INTER_COMMAND_DELAY_MS = 250;
/** Delay before issuing `reboot` after all writes complete — lets the last flash commit settle. */
export const BOARD_PRE_REBOOT_DELAY_MS = 500;
/** Delay after the port is opened, before any traffic is sent — Web Serial needs the OS driver
 *  to settle (USB enumeration, DTR/RTS lines). */
export const BOARD_OPEN_SETTLE_DELAY_MS = 500;
export const BOARD_CLOSE_TIMEOUT_MS = 15000;
export const BOARD_PROBE_TIMEOUT_MS = 3000;
export const BOARD_BOOT_TIMEOUT_MS = 5000;

export type BoardCliCommand =
  | { kind: 'single'; itemId: 'group_id' | 'broker'; commandWord: string }
  | {
      kind: 'chunked';
      itemId: 'certca' | 'certclient' | 'certkey';
      openCommand: string;
      closeCommand: string;
    }
  | { kind: 'plain'; itemId: 'reboot'; command: 'reboot' }
  | { kind: 'plain'; itemId: 'status'; command: 'status' };

export const BOARD_PROVISION_SEQUENCE: BoardCliCommand[] = [
  { kind: 'single', itemId: 'group_id', commandWord: 'group_id' },
  { kind: 'single', itemId: 'broker', commandWord: 'broker' },
  { kind: 'chunked', itemId: 'certca', openCommand: 'certca set', closeCommand: 'certca end' },
  {
    kind: 'chunked',
    itemId: 'certclient',
    openCommand: 'certclient set',
    closeCommand: 'certclient end',
  },
  { kind: 'chunked', itemId: 'certkey', openCommand: 'certkey set', closeCommand: 'certkey end' },
  { kind: 'plain', itemId: 'reboot', command: 'reboot' },
];

export const BOARD_REGISTER_SEQUENCE: BoardCliCommand[] = [
  { kind: 'plain', itemId: 'status', command: 'status' },
];

export const BOARD_REGISTER_STATUS_TIMEOUT_MS = 10000;

export function buildSingleCommandLine(
  cmd: Extract<BoardCliCommand, { kind: 'single' }>,
  value: string,
): string {
  return `${cmd.commandWord} ${value}`;
}

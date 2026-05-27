import { webSerialAdapter } from './web-serial-adapter';

type WebSerialPort = globalThis.SerialPort;
type WebSerialOptions = globalThis.SerialOptions;
type WebSerialOutputSignals = globalThis.SerialOutputSignals;

export interface SerialPortHandle {
  open(opts: WebSerialOptions): Promise<void>;
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  setSignals(signals: WebSerialOutputSignals): Promise<void>;
  close(): Promise<void>;
  readonly info: { displayName: string };
}

export interface SerialPortAdapter {
  requestPort(): Promise<SerialPortHandle>;
  getGrantedPorts(): Promise<SerialPortHandle[]>;
}

export type { WebSerialPort as SerialPort, WebSerialOptions as SerialOptions, WebSerialOutputSignals as SerialOutputSignals };

export const PORT_REQUEST_CANCELLED = Symbol('port-request-cancelled');

export function getSerialPortAdapter(): SerialPortAdapter {
  return (globalThis as { __SERIAL_ADAPTER__?: SerialPortAdapter }).__SERIAL_ADAPTER__ ?? webSerialAdapter;
}

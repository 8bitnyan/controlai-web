import { PORT_REQUEST_CANCELLED, type SerialPort, type SerialPortAdapter, type SerialPortHandle, type SerialOutputSignals, type SerialOptions } from './serial-port-adapter';

function getNavigatorSerial(): Serial {
  if (typeof navigator === 'undefined' || !('serial' in navigator)) {
    throw new Error('Web Serial API not available in this browser');
  }

  return navigator.serial;
}

function formatPortDisplayName(port: SerialPort): string {
  const info = port.getInfo();
  if (info.usbVendorId != null && info.usbProductId != null) {
    const vid = info.usbVendorId.toString(16).padStart(4, '0').toUpperCase();
    const pid = info.usbProductId.toString(16).padStart(4, '0').toUpperCase();
    return `USB ${vid}:${pid}`;
  }

  return 'Serial Port';
}

function toPortHandle(port: SerialPort): SerialPortHandle {
  return {
    async open(opts: SerialOptions) {
      await port.open(opts);
      try {
        await port.setSignals({ dataTerminalReady: true, requestToSend: false });
      } catch {
        // Some VCP implementations reject setSignals; continue without failing.
      }
    },
    get readable() {
      return port.readable!;
    },
    get writable() {
      return port.writable!;
    },
    async setSignals(signals: SerialOutputSignals) {
      await port.setSignals(signals);
    },
    async close() {
      await port.close();
    },
    get info() {
      return { displayName: formatPortDisplayName(port) };
    },
  };
}

export const webSerialAdapter: SerialPortAdapter = {
  /**
   * Must be called from a user-gesture handler (e.g. click) per browser policy.
   */
  async requestPort() {
    const serial = getNavigatorSerial();

    try {
      const port = await serial.requestPort();
      return toPortHandle(port);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        return Promise.reject(PORT_REQUEST_CANCELLED);
      }
      throw error;
    }
  },
  async getGrantedPorts() {
    const serial = getNavigatorSerial();
    const ports = await serial.getPorts();
    return ports.map(toPortHandle);
  },
};

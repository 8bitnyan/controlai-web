import type {
  SerialOptions,
  SerialOutputSignals,
  SerialPortAdapter,
  SerialPortHandle,
} from './serial-port-adapter';

const LINE_ENDING = '\r\n';

export type MockResponse = string | string[] | (() => Promise<void> | void);

export interface MockRule {
  onWrite: RegExp;
  respond?: MockResponse;
  delay?: number;
  closePort?: boolean;
  injectError?: string;
}

export type MockScript = MockRule[];

type PendingRead = {
  resolve: (chunk: Uint8Array | null) => void;
};

class MockPortHandle implements SerialPortHandle {
  public readonly info = { displayName: 'Mock Serial Port' };
  public readonly readable: ReadableStream<Uint8Array>;
  public readonly writable: WritableStream<Uint8Array>;

  public lastOpenOptions: SerialOptions | null = null;

  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  private readonly queue: Uint8Array[] = [];
  private readonly pendingReads: PendingRead[] = [];
  private isClosed = false;
  private readonly writeLog: string[];
  private readonly script: MockScript;

  constructor(script: MockScript, writeLog: string[]) {
    this.script = script;
    this.writeLog = writeLog;

    this.readable = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        const chunk = this.queue.shift();
        if (chunk) {
          controller.enqueue(chunk);
        }
        if (this.isClosed) {
          controller.close();
        }
      },
      cancel: () => {
        this.isClosed = true;
      },
    });

    this.writable = new WritableStream<Uint8Array>({
      write: async (chunk) => {
        if (this.isClosed) {
          throw new Error('Mock serial port is closed');
        }

        const decoded = this.decoder.decode(chunk);
        const lines = decoded.split(/\r?\n/);

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line && rawLine.length === 0) {
            continue;
          }

          this.writeLog.push(line);
          await this.applyFirstMatchingRule(line);

          if (this.isClosed) {
            break;
          }
        }
      },
    });
  }

  async open(opts: SerialOptions): Promise<void> {
    if (this.isClosed) {
      throw new Error('Mock serial port is closed');
    }
    this.lastOpenOptions = opts;
  }

  async setSignals(_signals: SerialOutputSignals): Promise<void> {
    if (this.isClosed) {
      throw new Error('Mock serial port is closed');
    }
  }

  async close(): Promise<void> {
    this.isClosed = true;
  }

  private async applyFirstMatchingRule(line: string): Promise<void> {
    const rule = this.script.find((candidate) => candidate.onWrite.test(line));
    if (!rule) {
      return;
    }

    if (rule.delay && rule.delay > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, rule.delay));
    }

    if (rule.injectError) {
      throw new Error(rule.injectError);
    }

    if (rule.respond) {
      await this.emitResponse(rule.respond);
    }

    if (rule.closePort) {
      this.isClosed = true;
    }
  }

  private async emitResponse(response: MockResponse): Promise<void> {
    if (typeof response === 'function') {
      await response();
      return;
    }

    const body = Array.isArray(response) ? response.join(LINE_ENDING) : response;
    const chunk = this.encoder.encode(`${body}${LINE_ENDING}`);
    this.queue.push(chunk);
  }
}

export class MockSerialPortAdapter implements SerialPortAdapter {
  public readonly writeLog: string[] = [];

  private readonly script: MockScript;
  private handle: MockPortHandle | null = null;

  constructor(script: MockScript) {
    this.script = script;
  }

  async requestPort(): Promise<SerialPortHandle> {
    this.handle = new MockPortHandle(this.script, this.writeLog);
    return this.handle;
  }

  async getGrantedPorts(): Promise<SerialPortHandle[]> {
    return this.handle ? [this.handle] : [];
  }
}

export function happyPathScript(): MockScript {
  return [
    { onWrite: /^$|^\?$/, respond: 'CLI> ' },
    { onWrite: /^group_id\s+.+$/i, respond: ['group_id set to: value', 'CLI> '] },
    { onWrite: /^broker\s+.+$/i, respond: ['broker set to: value', 'CLI> '] },
    { onWrite: /^certca\s+set$/i, respond: 'CA cert input mode...' },
    { onWrite: /^(?=.{9,}$)[0-9A-F]+$/i },
    {
      onWrite: /^certca\s+end$/i,
      respond: ['Cert stored: 1234 bytes DER (saved to flash).', 'CLI> '],
    },
    { onWrite: /^certclient\s+set$/i, respond: 'Client cert input mode...' },
    {
      onWrite: /^certclient\s+end$/i,
      respond: ['Cert stored: 1234 bytes DER (saved to flash).', 'CLI> '],
    },
    { onWrite: /^certkey\s+set$/i, respond: 'Private key input mode...' },
    {
      onWrite: /^certkey\s+end$/i,
      respond: ['Cert stored: 1234 bytes DER (saved to flash).', 'CLI> '],
    },
    { onWrite: /^reboot$/i, closePort: true },
  ];
}

import {
  BOARD_DEFAULT_FAILURE_REGEX,
  BOARD_INTER_CHUNK_DELAY_MS,
  BOARD_LINE_ENDING,
  BOARD_PROMPT_REGEX,
} from '../../../../packages/api/src/lib/board-cli-spec';

import type { SerialPortHandle } from './serial-port-adapter';
import { LineBreakTransformer } from './line-break-transformer';

export class CliFailureError extends Error {
  constructor(message: string, public readonly step?: string) {
    super(message);
    this.name = 'CliFailureError';
  }
}

export class CliTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliTimeoutError';
  }
}

type LineListener = (line: string) => void;
type ErrorListener = (error: unknown) => void;

type Pending = {
  lines: string[];
  resolve: (lines: string[]) => void;
  reject: (error: unknown) => void;
  successRegex?: RegExp;
  failureRegex?: RegExp;
  skipEcho: boolean;
  commandEcho?: string;
  firstLineSeen: boolean;
  timeout: ReturnType<typeof setTimeout>;
};

export class CliSession {
  private readonly lineListeners = new Set<LineListener>();
  private readonly errorListeners = new Set<ErrorListener>();
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private readLoopPromise: Promise<void> | null = null;
  private disposed = false;
  private pending: Pending | null = null;
  private pendingPromptWait: ((line: string) => void) | null = null;
  private readonly encoder = new TextEncoder();

  constructor(private readonly handle: SerialPortHandle) {}

  on(event: 'line', cb: LineListener): () => void;
  on(event: 'error', cb: ErrorListener): () => void;
  on(event: 'line' | 'error', cb: LineListener | ErrorListener): () => void {
    if (event === 'line') {
      this.lineListeners.add(cb as LineListener);
      return () => this.lineListeners.delete(cb as LineListener);
    }

    this.errorListeners.add(cb as ErrorListener);
    return () => this.errorListeners.delete(cb as ErrorListener);
  }

  async writeLine(line: string): Promise<void> {
    this.ensureNotDisposed();
    this.ensureIo();
    await this.writer!.write(this.encoder.encode(`${line}${BOARD_LINE_ENDING}`));
  }

  async writeChunks(lines: string[]): Promise<void> {
    for (let index = 0; index < lines.length; index += 1) {
      await this.writeLine(lines[index]!);
      if (index < lines.length - 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, BOARD_INTER_CHUNK_DELAY_MS));
      }
    }
  }

  async sendCommand(
    cmd: string,
    opts: { timeoutMs: number; failureRegex?: RegExp; successRegex?: RegExp; skipEcho?: boolean },
  ): Promise<string[]> {
    this.ensureNotDisposed();
    this.ensureIo();
    if (this.pending) {
      throw new Error('Another command is already in flight');
    }

    const commandEcho = cmd.trim();

    const result = new Promise<string[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending = null;
        reject(new CliTimeoutError(`Command timed out: ${cmd}`));
      }, opts.timeoutMs);

      this.pending = {
        lines: [],
        resolve,
        reject,
          successRegex: opts.successRegex,
          failureRegex: opts.failureRegex ?? BOARD_DEFAULT_FAILURE_REGEX,
          skipEcho: opts.skipEcho ?? true,
          commandEcho,
        firstLineSeen: false,
        timeout,
      };
    });

    await this.writeLine(cmd);
    return result;
  }

  async waitForPrompt({ timeoutMs }: { timeoutMs: number }): Promise<void> {
    this.ensureNotDisposed();
    this.ensureIo();

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingPromptWait = null;
        reject(new CliTimeoutError('Prompt wait timed out'));
      }, timeoutMs);

      this.pendingPromptWait = (line) => {
        if (!BOARD_PROMPT_REGEX.test(line)) {
          return;
        }
        clearTimeout(timeout);
        this.pendingPromptWait = null;
        resolve();
      };
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    if (this.pending) {
      clearTimeout(this.pending.timeout);
      this.pending.reject(new Error('CliSession disposed'));
      this.pending = null;
    }

    await this.reader?.cancel();
    this.reader?.releaseLock();

    this.writer?.releaseLock();
    await this.readLoopPromise?.catch(() => undefined);
  }

  private ensureIo() {
    if (this.reader && this.writer) {
      return;
    }

    this.reader = (this.handle.readable as ReadableStream<Uint8Array>)
      .pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>)
      .pipeThrough(new TransformStream(new LineBreakTransformer()))
      .getReader();

    this.writer = this.handle.writable.getWriter();

    this.readLoopPromise = this.runReadLoop();
  }

  private async runReadLoop(): Promise<void> {
    try {
      while (!this.disposed) {
        const result = await this.reader!.read();
        if (result.done) {
          break;
        }

        this.emitLine(result.value);
      }
    } catch (error) {
      this.emitError(error);
      if (this.pending) {
        clearTimeout(this.pending.timeout);
        this.pending.reject(error);
        this.pending = null;
      }
    }
  }

  private emitLine(line: string) {
    for (const listener of this.lineListeners) {
      listener(line);
    }

    this.pendingPromptWait?.(line);

    if (!this.pending) {
      return;
    }

    const pending = this.pending;
    if (!pending.firstLineSeen) {
      pending.firstLineSeen = true;
      if (pending.skipEcho && line.trim() === pending.commandEcho) {
        return;
      }
    }

    pending.lines.push(line);

    if (pending.failureRegex?.test(line)) {
      this.pending = null;
      clearTimeout(pending.timeout);
      pending.reject(new CliFailureError(`Command failed: ${line}`, line));
      return;
    }

    const successMatch = pending.successRegex?.test(line) ?? false;
    const promptMatch = BOARD_PROMPT_REGEX.test(line);
    if (successMatch || promptMatch) {
      this.pending = null;
      clearTimeout(pending.timeout);
      pending.resolve(pending.lines);
    }
  }

  private emitError(error: unknown) {
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }

  private ensureNotDisposed() {
    if (this.disposed) {
      throw new Error('CliSession already disposed');
    }
  }
}

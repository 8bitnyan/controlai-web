export class SerialProvisioner {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();
  private buffer = '';

  async connect(): Promise<void> {
    if (!navigator.serial) throw new Error('Web Serial unsupported');
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
    this.reader = this.port.readable?.getReader() ?? null;
    this.writer = this.port.writable?.getWriter() ?? null;
    if (!this.reader || !this.writer) throw new Error('Serial stream unavailable');
  }
  async disconnect(): Promise<void> { await this.reader?.cancel(); this.reader?.releaseLock(); this.writer?.releaseLock(); await this.port?.close(); }
  async readInfo() { await this.sendLine('INFO'); const lines = await this.readUntilOk(10_000); return JSON.parse(lines[0] ?? '{}'); }
  async setGroupId(v: string) { await this.sendExpectOk(`SET group_id ${v}`, 10_000); }
  async setEndpoint(v: string) { await this.sendExpectOk(`SET endpoint ${v}`, 10_000); }
  async writeFile(path: '/etc/controlai/ca.pem' | '/etc/controlai/cert.pem' | '/etc/controlai/key.pem', bytes: Uint8Array) {
    await this.sendLine(`WRITE ${path} ${bytes.length}`);
    const ready = await this.readLine(60_000);
    if (ready !== 'READY') throw new Error(`Expected READY, got ${ready}`);
    await this.writer!.write(bytes);
    const done = await this.readLine(60_000);
    if (!done.startsWith('OK ')) throw new Error(done);
    const expected = done.slice(3).trim().toLowerCase();
    const hash = await crypto.subtle.digest('SHA-256', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const actual = Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
    if (expected && expected !== actual) throw new Error(`sha256 mismatch: expected ${expected}, got ${actual}`);
  }
  async commit() { await this.sendExpectOk('COMMIT', 10_000); }
  async reboot() { await this.sendExpectOk('REBOOT', 60_000); }

  private async sendExpectOk(line: string, timeoutMs: number) { await this.sendLine(line); const out = await this.readLine(timeoutMs); if (!out.startsWith('OK')) throw new Error(out); }
  private async sendLine(line: string) { await this.writer!.write(this.encoder.encode(`${line}\n`)); }
  private async readUntilOk(timeoutMs: number): Promise<string[]> { const list: string[] = []; for (;;) { const line = await this.readLine(timeoutMs); if (line === 'OK') return list; if (line.startsWith('# ')) continue; if (line.startsWith('ERR ')) throw new Error(line); list.push(line); } }
  private async readLine(timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const idx = this.buffer.indexOf('\n');
      if (idx >= 0) {
        const line = this.buffer.slice(0, idx).replace(/\r$/, '');
        this.buffer = this.buffer.slice(idx + 1);
        if (line.startsWith('# ')) continue;
        return line;
      }
      if (Date.now() > deadline) throw new Error('Serial timeout');
      const { value, done } = await this.reader!.read();
      if (done) throw new Error('Serial disconnected');
      this.buffer += this.decoder.decode(value, { stream: true });
    }
  }
}

import { describe, expect, it, vi } from 'vitest';

import { BOARD_INTER_CHUNK_DELAY_MS } from '../../../../../packages/api/src/lib/board-cli-spec';
import { CliSession, CliTimeoutError } from '../cli-session';
import { MockSerialPortAdapter } from '../mock-serial-adapter';

describe('CliSession', () => {
  it('sendCommand resolves on CLI prompt', async () => {
    const adapter = new MockSerialPortAdapter([{ onWrite: /^status$/, respond: ['ok', 'CLI> '] }]);
    const handle = await adapter.requestPort();
    const session = new CliSession(handle);

    const lines = await session.sendCommand('status', { timeoutMs: 500 });

    expect(lines).toEqual(['ok', 'CLI> ']);
    await session.dispose();
  });

  it('sendCommand rejects on failureRegex match', async () => {
    const adapter = new MockSerialPortAdapter([{ onWrite: /^status$/, respond: 'error: bad command' }]);
    const handle = await adapter.requestPort();
    const session = new CliSession(handle);

    await expect(session.sendCommand('status', { timeoutMs: 500 })).rejects.toThrow('Command failed');
    await session.dispose();
  });

  it('sendCommand resolves on successRegex match', async () => {
    const adapter = new MockSerialPortAdapter([{ onWrite: /^certca end$/i, respond: 'saved to flash' }]);
    const handle = await adapter.requestPort();
    const session = new CliSession(handle);

    const lines = await session.sendCommand('certca end', {
      timeoutMs: 500,
      successRegex: /saved to flash/i,
    });

    expect(lines).toContain('saved to flash');
    await session.dispose();
  });

  it('sendCommand rejects on timeout', async () => {
    const adapter = new MockSerialPortAdapter([]);
    const handle = await adapter.requestPort();
    const session = new CliSession(handle);

    await expect(session.sendCommand('status', { timeoutMs: 20 })).rejects.toBeInstanceOf(CliTimeoutError);
    await session.dispose();
  });

  it('skipEcho drops first echoed line by default', async () => {
    const adapter = new MockSerialPortAdapter([
      { onWrite: /^status$/, respond: ['status', 'board info', 'CLI> '] },
    ]);
    const handle = await adapter.requestPort();
    const session = new CliSession(handle);

    const lines = await session.sendCommand('status', { timeoutMs: 500 });

    expect(lines).toEqual(['board info', 'CLI> ']);
    await session.dispose();
  });

  it('writeChunks inserts delay between lines', async () => {
    vi.useFakeTimers();
    const adapter = new MockSerialPortAdapter([]);
    const handle = await adapter.requestPort();
    const session = new CliSession(handle);

    const promise = session.writeChunks(['A', 'B', 'C']);
    await vi.advanceTimersByTimeAsync(BOARD_INTER_CHUNK_DELAY_MS * 2 + 10);
    await promise;

    expect(adapter.writeLog).toEqual(['A', 'B', 'C']);
    vi.useRealTimers();
    await session.dispose();
  });

  it('dispose unlocks streams without closing adapter lifecycle', async () => {
    const adapter = new MockSerialPortAdapter([{ onWrite: /^status$/, respond: ['ok', 'CLI> '] }]);
    const handle = await adapter.requestPort();
    const session = new CliSession(handle);

    await session.sendCommand('status', { timeoutMs: 500 });
    await session.dispose();

    const nextHandle = await adapter.requestPort();
    const nextSession = new CliSession(nextHandle);
    await expect(nextSession.sendCommand('status', { timeoutMs: 500 })).resolves.toEqual(['ok', 'CLI> ']);
    await nextSession.dispose();
  });
});

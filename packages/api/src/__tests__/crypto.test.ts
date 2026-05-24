import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Set INSTANCE_TOKEN_KEY before importing crypto module
const TEST_KEY = 'a'.repeat(64); // 32-byte hex key (64 hex chars)
process.env.INSTANCE_TOKEN_KEY = TEST_KEY;

// Import after setting env
import { encryptToken, decryptToken, _resetKeyForTest } from '../lib/crypto';

describe('crypto — AES-256-GCM token encryption', () => {
  beforeEach(() => {
    process.env.INSTANCE_TOKEN_KEY = TEST_KEY;
    _resetKeyForTest();
  });

  afterEach(() => {
    _resetKeyForTest();
  });

  it('round-trips a plaintext token', () => {
    const plaintext = 'super-secret-bearer-token-12345';
    const ciphertext = encryptToken(plaintext);
    const decrypted = decryptToken(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const plaintext = 'same-token';
    const c1 = encryptToken(plaintext);
    const c2 = encryptToken(plaintext);
    expect(c1).not.toBe(c2);
    // But both decrypt to the same value
    expect(decryptToken(c1)).toBe(plaintext);
    expect(decryptToken(c2)).toBe(plaintext);
  });

  it('throws on tampered ciphertext', () => {
    const ciphertext = encryptToken('hello');
    const parts = ciphertext.split(':');
    // Corrupt the encrypted payload
    const corrupted = [parts[0], 'dGFtcGVyZWQ=', parts[2]].join(':');
    expect(() => decryptToken(corrupted)).toThrow();
  });

  it('throws on malformed ciphertext (wrong segment count)', () => {
    expect(() => decryptToken('notvalid')).toThrow('Invalid ciphertext format');
  });

  it('throws when INSTANCE_TOKEN_KEY is missing', () => {
    delete process.env.INSTANCE_TOKEN_KEY;
    _resetKeyForTest();

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {
        throw new Error('process.exit called');
      }) as never);

    expect(() => encryptToken('token')).toThrow();
    exitSpy.mockRestore();
  });
});

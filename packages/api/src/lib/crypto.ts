/**
 * AES-256-GCM encryption for ControlaiInstance bearer tokens.
 *
 * The key is loaded from INSTANCE_TOKEN_KEY (32-byte hex string).
 * The process throws at startup (module import time) if the key is absent.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const _AUTH_TAG_LENGTH = 16;

function loadKey(): Buffer {
  const keyHex = process.env.INSTANCE_TOKEN_KEY;
  if (!keyHex) {
    console.error('INSTANCE_TOKEN_KEY is required');
    process.exit(1);
  }
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error(
      `INSTANCE_TOKEN_KEY must be a 64-char hex string (32 bytes). Got ${key.length} bytes.`,
    );
  }
  return key;
}

// Lazy-load key so unit tests can inject before import resolves in test environments
let _key: Buffer | null = null;
function getKey(): Buffer {
  if (!_key) {
    _key = loadKey();
  }
  return _key;
}

/**
 * Encrypt a plaintext string.
 * Returns a base64-encoded string: <iv>:<ciphertext>:<authTag>
 */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  // Encode as iv:ciphertext:authTag separated by colons, all base64
  return [
    iv.toString('base64'),
    encrypted.toString('base64'),
    authTag.toString('base64'),
  ].join(':');
}

/**
 * Decrypt a token previously encrypted by encryptToken.
 * Throws if the ciphertext has been tampered with.
 */
export function decryptToken(ciphertext: string): string {
  const key = getKey();
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format');
  }
  const [ivB64, encB64, tagB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, 'base64');
  const encrypted = Buffer.from(encB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    throw new Error('Decryption failed: ciphertext may have been tampered with');
  }
}

/** Exposed for testing: reset cached key (test environments only). */
export function _resetKeyForTest(): void {
  _key = null;
}

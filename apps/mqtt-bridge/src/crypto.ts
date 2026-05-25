import { createDecipheriv } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const keyHex = process.env.INSTANCE_TOKEN_KEY;
  if (!keyHex) throw new Error('INSTANCE_TOKEN_KEY is required');
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error(`INSTANCE_TOKEN_KEY must be 32 bytes. Got ${key.length} bytes.`);
  }
  cachedKey = key;
  return key;
}

export function decryptToken(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('Invalid ciphertext format');
  const [ivB64, encB64, tagB64] = parts as [string, string, string];
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}

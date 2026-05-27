import { describe, it, expect } from 'vitest';
import { pemToHexChunks } from '../pem-to-hex';

const DER_BYTES = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1));
const DER_B64 = DER_BYTES.toString('base64');
const DER_HEX = DER_BYTES.toString('hex').toUpperCase();

const pemWrap = (armor: string, body: string, eol = '\n') =>
  `-----BEGIN ${armor}-----${eol}${body}${eol}-----END ${armor}-----${eol}`;

describe('pemToHexChunks', () => {
  it('handles CERTIFICATE armor', () => {
    const pem = pemWrap('CERTIFICATE', DER_B64);
    const chunks = pemToHexChunks(pem);
    expect(chunks.join('')).toBe(DER_HEX);
  });

  it('handles PRIVATE KEY armor', () => {
    const pem = pemWrap('PRIVATE KEY', DER_B64);
    expect(pemToHexChunks(pem).join('')).toBe(DER_HEX);
  });

  it('handles RSA PRIVATE KEY armor', () => {
    const pem = pemWrap('RSA PRIVATE KEY', DER_B64);
    expect(pemToHexChunks(pem).join('')).toBe(DER_HEX);
  });

  it('handles EC PRIVATE KEY armor', () => {
    const pem = pemWrap('EC PRIVATE KEY', DER_B64);
    expect(pemToHexChunks(pem).join('')).toBe(DER_HEX);
  });

  it('handles CRLF and LF line endings', () => {
    const bodyMultiline = `${DER_B64.slice(0, 10)}\r\n${DER_B64.slice(10, 22)}\n${DER_B64.slice(22)}`;
    const pem = `-----BEGIN CERTIFICATE-----\r\n${bodyMultiline}\r\n-----END CERTIFICATE-----\n`;
    expect(pemToHexChunks(pem).join('')).toBe(DER_HEX);
  });

  it('handles leading/trailing whitespace and multiline body', () => {
    const bodyMultiline = `${DER_B64.slice(0, 8)}\n${DER_B64.slice(8, 20)}\n${DER_B64.slice(20)}`;
    const pem = `\n  ${pemWrap('CERTIFICATE', bodyMultiline)}\t  `;
    expect(pemToHexChunks(pem).join('')).toBe(DER_HEX);
  });

  it('throws when PEM has no base64 body after stripping', () => {
    const pem = '-----BEGIN CERTIFICATE-----\n\n-----END CERTIFICATE-----';
    expect(() => pemToHexChunks(pem)).toThrow('No base64 body found in PEM');
  });

  it('throws on malformed input without a decodable body', () => {
    const malformed = '   \n\r\t  ';
    expect(() => pemToHexChunks(malformed)).toThrow('No base64 body found in PEM');
  });

  it('splits into expected chunk count for known DER size', () => {
    const knownBytes = Buffer.from(Array.from({ length: 150 }, (_, i) => i));
    const pem = pemWrap('CERTIFICATE', knownBytes.toString('base64'));
    const chunks = pemToHexChunks(pem, 120);

    const expectedHexLen = knownBytes.length * 2;
    expect(chunks.length).toBe(Math.ceil(expectedHexLen / 120));
    expect(chunks.every((chunk) => chunk.length <= 120)).toBe(true);
  });

  it('supports chunkSize override', () => {
    const pem = pemWrap('CERTIFICATE', DER_B64);
    const chunks = pemToHexChunks(pem, 10);
    expect(chunks.every((chunk) => chunk.length <= 10)).toBe(true);
    expect(chunks.join('')).toBe(DER_HEX);
  });

  it('concatenated chunks round-trip to known uppercase hex', () => {
    const pem = pemWrap('CERTIFICATE', DER_B64);
    const chunks = pemToHexChunks(pem, 7);
    expect(chunks.join('')).toBe(DER_HEX);
    expect(chunks.join('')).toMatch(/^[0-9A-F]+$/);
  });
});

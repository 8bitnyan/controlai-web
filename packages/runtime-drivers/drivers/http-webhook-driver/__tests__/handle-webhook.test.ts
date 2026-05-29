import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { handleWebhook, type HttpWebhookDriverConfig } from '../index';

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

const config: HttpWebhookDriverConfig = {
  secret: 'shared-secret-xyz',
  jsonMapper: {
    deviceKeyPath: 'meta.deviceKey',
    dataTypePath: 'meta.dataType',
    payloadPath: 'data',
  },
  requireHmac: true,
  allowedSkewSec: 300,
};

const CUID = 'cklm1q2r3000a01abcdef1234';

describe('handleWebhook', () => {
  it('accepts valid HMAC + mapping', () => {
    const body = JSON.stringify({ meta: { deviceKey: CUID, dataType: 'data' }, data: { v: 1 } });
    const result = handleWebhook(config, {
      rawBody: body,
      headers: { 'x-controlai-signature': sign(config.secret, body) },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.deviceKey).toBe(CUID);
      expect(result.message.dataType).toBe('data');
      expect(result.message.sourceDriver).toBe('http-webhook-driver');
    }
  });

  it('rejects bad HMAC with 401', () => {
    const body = JSON.stringify({ meta: { deviceKey: CUID, dataType: 'data' }, data: {} });
    const result = handleWebhook(config, {
      rawBody: body,
      headers: { 'x-controlai-signature': 'deadbeef' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it('rejects missing signature when requireHmac=true', () => {
    const body = '{}';
    const result = handleWebhook(config, { rawBody: body, headers: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it('rejects stale timestamp', () => {
    const body = JSON.stringify({ meta: { deviceKey: CUID, dataType: 'data' }, data: {} });
    const result = handleWebhook(config, {
      rawBody: body,
      headers: {
        'x-controlai-signature': sign(config.secret, body),
        'x-controlai-timestamp': String(0),
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it('rejects malformed JSON', () => {
    const body = 'not json';
    const result = handleWebhook(config, {
      rawBody: body,
      headers: { 'x-controlai-signature': sign(config.secret, body) },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('rejects when jsonMapper fails to resolve fields', () => {
    const body = JSON.stringify({ wrong: 'shape' });
    const result = handleWebhook(config, {
      rawBody: body,
      headers: { 'x-controlai-signature': sign(config.secret, body) },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('skips HMAC check when requireHmac=false', () => {
    const body = JSON.stringify({ meta: { deviceKey: CUID, dataType: 'birth' }, data: {} });
    const result = handleWebhook({ ...config, requireHmac: false }, {
      rawBody: body,
      headers: {},
    });
    expect(result.ok).toBe(true);
  });
});

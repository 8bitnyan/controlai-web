import { jwtVerify } from 'jose';
import type { Context } from 'hono';

const STREAM_JWT_SECRET_RAW = process.env.STREAM_JWT_SECRET;

/**
 * Extract and verify a HS256 JWT from the ?token= query param.
 * Returns the decoded payload or throws if invalid.
 */
export async function verifyStreamToken(
  token: string,
): Promise<Record<string, unknown>> {
  if (!STREAM_JWT_SECRET_RAW) {
    throw new Error('STREAM_JWT_SECRET is not configured');
  }
  const secret = new TextEncoder().encode(STREAM_JWT_SECRET_RAW);
  const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
  return payload as Record<string, unknown>;
}

/**
 * Middleware helper — reads ?token= from query string and verifies it.
 * Returns 401 if absent/invalid, calls next() on success.
 */
export async function requireToken(c: Context, next: () => Promise<void>): Promise<Response | void> {
  const token = c.req.query('token');
  if (!token) {
    return c.text('Unauthorized: missing token', 401);
  }
  try {
    await verifyStreamToken(token);
  } catch {
    return c.text('Unauthorized: invalid or expired token', 401);
  }
  return next();
}

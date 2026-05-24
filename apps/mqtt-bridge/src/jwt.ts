import { jwtVerify } from 'jose';

export interface JWTPayload {
  siteId: string;
  userId: string;
  iat: number;
  exp: number;
}

/**
 * Verify an HS256 JWT and return the decoded payload.
 * Throws on invalid signature, expiry, or missing claims.
 */
export async function verifyJWT(token: string, secret: string): Promise<JWTPayload> {
  const key = new TextEncoder().encode(secret);

  const { payload } = await jwtVerify(token, key, {
    algorithms: ['HS256'],
  });

  if (typeof payload.siteId !== 'string' || typeof payload.userId !== 'string') {
    throw new Error('JWT missing required claims');
  }

  return {
    siteId: payload.siteId,
    userId: payload.userId,
    iat: typeof payload.iat === 'number' ? payload.iat : 0,
    exp: typeof payload.exp === 'number' ? payload.exp : 0,
  };
}

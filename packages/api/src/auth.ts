import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { organization } from 'better-auth/plugins';
import { prisma } from '@controlai-web/db';
import { bootstrapDefaultInstance } from './lib/bootstrap-default-instance';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  secret: requireEnv('BETTER_AUTH_SECRET'),
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    cookieCache: {
      enabled: true,
      maxAge: 60, // 60 s — reduces DB reads
    },
  },

  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      organizationLimit: 5,
      membershipLimit: 100,
      organizationHooks: {
        afterCreateOrganization: async ({ organization: org, user }) => {
          // Best-effort: failure to bootstrap the default daemon must not
          // block organization creation. Errors are logged for operator triage.
          try {
            await bootstrapDefaultInstance(prisma, org.id, user.id);
          } catch (error) {
            console.error('[auth] bootstrapDefaultInstance failed', {
              orgId: org.id,
              userId: user.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        },
      },
    }),
  ],

  advanced: {
    defaultCookieAttributes: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    },
  },
});

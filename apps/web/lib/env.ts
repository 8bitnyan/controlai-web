/**
 * Environment variable validation — fails fast at startup if required vars are missing.
 * Import this module early (e.g. next.config.ts or layout.tsx) to catch misconfig.
 */

const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'INSTANCE_TOKEN_KEY',
  'CRON_SECRET',
] as const;

function validateEnv(): void {
  const missing: string[] = [];

  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    const msg = [
      '❌ Missing required environment variables:',
      ...missing.map((k) => `  - ${k}`),
      '',
      'Copy apps/web/.env.example to apps/web/.env.local and fill in the required values.',
      'See openspec/changes/add-controlai-web-skeleton/design.md for details.',
    ].join('\n');

    console.error(msg);
    process.exit(1);
  }
}

// Validate immediately on import (server-side only)
if (typeof window === 'undefined') {
  validateEnv();
}

export const env = {
  DATABASE_URL: process.env.DATABASE_URL!,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET!,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL!,
  INSTANCE_TOKEN_KEY: process.env.INSTANCE_TOKEN_KEY!,
  CRON_SECRET: process.env.CRON_SECRET!,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  NODE_ENV: process.env.NODE_ENV ?? 'development',
} as const;

export const SLUG_REGEX = /^[a-z][a-z0-9-]{1,63}$/;

export class InvalidSlugError extends Error {
  constructor(slug: string) {
    super(`Invalid organization slug: ${slug}`);
    this.name = 'InvalidSlugError';
  }
}

export type ProvisionEnv = 'prod' | 'staging' | 'dev';

export function deriveSubdomain(slug: string, env: ProvisionEnv): string {
  if (!SLUG_REGEX.test(slug)) {
    throw new InvalidSlugError(slug);
  }

  return `${slug}-${env}`;
}

import { describe, expect, it } from 'vitest';
import { deriveSubdomain, InvalidSlugError, type ProvisionEnv } from '../org-slug';

describe('deriveSubdomain', () => {
  const envs = ['prod', 'staging', 'dev'] as const satisfies readonly ProvisionEnv[];

  it('derives subdomain for each env', () => {
    expect(deriveSubdomain('acme', envs[0])).toBe('acme-prod');
    expect(deriveSubdomain('acme', envs[1])).toBe('acme-staging');
    expect(deriveSubdomain('acme', envs[2])).toBe('acme-dev');
  });

  it('throws InvalidSlugError for invalid slugs', () => {
    const invalidSlugs = [
      'UPPERCASE',
      '1leading',
      'bad_underscore',
      'a',
      'a'.repeat(65),
    ];

    for (const slug of invalidSlugs) {
      expect(() => deriveSubdomain(slug, 'prod')).toThrow(InvalidSlugError);
    }
  });
});

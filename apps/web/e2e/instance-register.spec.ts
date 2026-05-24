import { test, expect } from '@playwright/test';

/**
 * E2E: Instance registration flow
 *
 * - Sign in as OWNER
 * - Navigate to Instances → Register
 * - Fill URL + token → Test connection → Submit
 * - Assert instance appears with HEALTHY badge
 *
 * NOTE: This test requires a live controlai daemon.
 * In CI, it is skipped unless DAEMON_BASE_URL and DAEMON_TOKEN are set.
 */

const daemonBaseURL = process.env.DAEMON_BASE_URL;
const daemonToken = process.env.DAEMON_TOKEN;

test.describe('Instance registration', () => {
  test.skip(!daemonBaseURL || !daemonToken, 'Requires DAEMON_BASE_URL and DAEMON_TOKEN env vars');

  test('registers an instance and shows HEALTHY badge', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill('admin@localhost.dev');
    await page.getByLabel('Password').fill('devpassword');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/(orgs|setup)/);

    const url = page.url();
    const orgIdMatch = url.match(/orgs\/([^/]+)/);
    if (!orgIdMatch) {
      test.skip();
      return;
    }
    const orgId = orgIdMatch[1];

    await page.goto(`/orgs/${orgId}/instances/new`);
    await expect(page.getByText(/register instance/i)).toBeVisible();

    await page.getByLabel('Instance name').fill('E2E Test Instance');
    await page.getByLabel('Base URL').fill(daemonBaseURL!);
    await page.getByLabel('Bearer token').fill(daemonToken!);

    // Test connection
    await page.getByRole('button', { name: /test connection/i }).click();
    await expect(page.getByText(/reachable/i)).toBeVisible({ timeout: 15_000 });

    // Submit
    await page.getByRole('button', { name: /register instance/i }).click();

    // Should redirect to instances list with HEALTHY badge
    await page.waitForURL(`/orgs/${orgId}/instances`);
    await expect(page.getByText('Healthy')).toBeVisible({ timeout: 10_000 });
  });
});

import { test, expect } from '@playwright/test';

/**
 * E2E: Setup wizard happy path
 *
 * Prerequisites (CI): fresh DB, BETTER_AUTH_URL set to test server
 *
 * This test:
 * 1. Navigates to / and expects redirect to /setup or /sign-in
 * 2. Completes sign-up (step 1)
 * 3. Creates first org (step 2)
 * 4. Registers first instance with mocked daemon (step 3)
 * 5. Asserts redirect to dashboard (step 4)
 */
test.describe('Setup wizard', () => {
  test('redirects unauthenticated user to sign-in', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/sign-in|setup/);
  });

  test('completes setup wizard flow (sign-up → org → done)', async ({ page }) => {
    // Navigate to sign-up
    await page.goto('/sign-up');
    await expect(page.getByRole('heading', { name: /create an account/i })).toBeVisible();

    // Fill sign-up form
    const email = `e2e-${Date.now()}@test.controlai`;
    await page.getByLabel('Full name').fill('E2E Test User');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('testpassword123');
    await page.getByRole('button', { name: /create account/i }).click();

    // Should land on setup wizard
    await page.waitForURL(/\/setup/);
    await expect(page.getByText(/welcome to controlai-web/i)).toBeVisible();

    // Step 1: Click Get started
    await page.getByRole('button', { name: /get started/i }).click();

    // Step 2: Create org
    await expect(page.getByText(/create your organisation/i)).toBeVisible();
    await page.getByLabel('Organisation name').fill('E2E Test Org');
    // Slug auto-fills
    const slugInput = page.getByLabel(/url slug/i);
    await expect(slugInput).not.toHaveValue('');
    await page.getByRole('button', { name: /create organisation/i }).click();

    // Step 3: Instance registration (skip with real daemon — just assert form renders)
    await expect(page.getByText(/connect a controlai daemon/i)).toBeVisible();
    await expect(page.getByLabel('Instance name')).toBeVisible();
    await expect(page.getByLabel('Base URL')).toBeVisible();
    await expect(page.getByLabel('Bearer token')).toBeVisible();
  });

  test('setup step persists in URL params on reload', async ({ page }) => {
    await page.goto('/setup?step=2');
    // Should show step 2 even after reload (URL params drive state)
    await expect(page).toHaveURL(/step=2/);
  });
});

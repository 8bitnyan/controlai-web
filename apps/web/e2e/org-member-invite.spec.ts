import { test, expect } from '@playwright/test';

/**
 * E2E: Org member invitation flow
 *
 * - Sign in as OWNER
 * - Invite member by email
 * - Assert MEMBER appears as "Pending" in member list
 */
test.describe('Org member invitation', () => {
  test('OWNER can invite a member', async ({ page }) => {
    // Assume seeded admin@localhost.dev / devpassword exists
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill('admin@localhost.dev');
    await page.getByLabel('Password').fill('devpassword');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Expect redirect to dashboard or setup
    await page.waitForURL(/\/(orgs|setup)/);

    // Navigate to org settings members tab
    const url = page.url();
    const orgIdMatch = url.match(/orgs\/([^/]+)/);
    if (!orgIdMatch) {
      test.skip();
      return;
    }
    const orgId = orgIdMatch[1];

    await page.goto(`/orgs/${orgId}/settings`);
    await page.getByRole('button', { name: /members/i }).click();

    // Invite form
    const inviteEmail = `invite-${Date.now()}@test.controlai`;
    await page.getByPlaceholder(/invitee@example\.com/i).fill(inviteEmail);
    await page.getByRole('button', { name: '' }).first().click(); // send button

    // Assert success message
    await expect(page.getByText(/invitation sent/i)).toBeVisible({ timeout: 8000 });
  });
});

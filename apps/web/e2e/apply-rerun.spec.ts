import { test, expect } from '@playwright/test';

/**
 * E2E: Apply failure → Re-run failed ops
 *
 * Prerequisites:
 * - E2E_CANVAS_URL: path to a siteGroup canvas
 * - E2E_DAEMON_MOCK: 'true' with daemon mocked to return 500 on createSite
 *
 * Covers spec requirements:
 *   - "Apply error surfacing — daemon error detail in modal"
 *   - "Apply run history — last-apply status in canvas toolbar"
 *   - Scenario: Canvas toolbar shows failure state + Re-run button
 *   - Scenario: Daemon error body displayed in modal
 */
test.describe('Apply failure and re-run', () => {
  const CANVAS_URL = process.env.E2E_CANVAS_URL;

  test.skip(!CANVAS_URL, 'E2E_CANVAS_URL not set');
  test.skip(!process.env.E2E_DAEMON_MOCK, 'Requires E2E_DAEMON_MOCK=true for daemon 500 simulation');

  test('failed apply shows error detail in modal and Re-run failed ops button', async ({ page }) => {
    await page.goto(CANVAS_URL!);

    const canvas = page.locator('.react-flow__pane');

    // Drop a Broker node (will trigger daemon API call that is mocked to 500)
    const brokerItem = page.getByRole('listitem').filter({ hasText: /^Broker/i }).first();
    await brokerItem.dragTo(canvas);

    // Click Apply
    await page.getByRole('button', { name: /^apply$/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Wait for preview ops to load
    const confirmBtn = dialog.getByRole('button', { name: /confirm.*apply/i });
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();

    // Apply runs — daemon returns 500, so ops should show "failed"
    await expect(
      dialog.locator('.react-flow__node, [class*="failed"]').first()
    ).toBeVisible({ timeout: 10000 });

    // "Re-run failed ops" button should appear
    await expect(dialog.getByRole('button', { name: /re-run failed ops/i })).toBeVisible();

    // Daemon error message shown in monospace block (errorDetail)
    await expect(dialog.locator('pre')).toBeVisible();
  });

  test('toolbar shows Last apply failed with Re-run button after failed apply', async ({ page }) => {
    await page.goto(CANVAS_URL!);

    // After a prior failed apply run, the toolbar should show failure state
    // (this test assumes E2E_PRE_FAILED_APPLY env var sets up the state)
    test.skip(!process.env.E2E_PRE_FAILED_APPLY, 'Requires E2E_PRE_FAILED_APPLY state');

    await expect(page.getByText('Last apply failed')).toBeVisible({ timeout: 3000 });
    await expect(page.getByRole('button', { name: /re-run/i })).toBeVisible();

    // Clicking Re-run opens the Apply modal
    await page.getByRole('button', { name: /re-run/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3000 });
  });
});

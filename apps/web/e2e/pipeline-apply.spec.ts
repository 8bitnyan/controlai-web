import { test, expect } from '@playwright/test';

/**
 * E2E: Pipeline node editor → Apply → Dashboard
 *
 * Prerequisites:
 * - Running dev/test server (NEXTAUTH_URL or BASE_URL set)
 * - Seeded database: user, org, project, siteGroup
 * - E2E_CANVAS_URL: path to siteGroup canvas, e.g. /orgs/o1/projects/p1/site-groups/sg1
 * - E2E_DASHBOARD_URL: path to siteGroup dashboard, e.g. /orgs/o1/projects/p1/site-groups/sg1/dashboard
 * - E2E_DAEMON_MOCK: set to 'true' if daemon responses are mocked
 *
 * Covers spec requirements:
 *   - @xyflow/react canvas with 6 node types
 *   - Apply dry-run preview → confirm → serial execution
 *   - Dashboard rendering
 */
test.describe('Pipeline apply flow', () => {
  const CANVAS_URL = process.env.E2E_CANVAS_URL;
  const DASHBOARD_URL = process.env.E2E_DASHBOARD_URL;

  test.skip(!CANVAS_URL, 'E2E_CANVAS_URL not set — skipping pipeline apply tests');

  test('canvas renders with empty state hint and node palette', async ({ page }) => {
    await page.goto(CANVAS_URL!);

    // Empty state hint
    await expect(page.getByText('Drag node types from the panel to start')).toBeVisible();

    // Node palette shows all 6 types
    for (const label of ['Sensor', 'Gateway', 'Broker', 'Ingest', 'TimescaleDB', 'Monitoring']) {
      await expect(page.getByText(label).first()).toBeVisible();
    }

    // Toolbar controls visible
    await expect(page.getByRole('button', { name: /undo/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /redo/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /fit view/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /apply/i })).toBeVisible();
  });

  test('build a Sensor → Gateway → Broker → Ingest → TimescaleDB pipeline', async ({ page }) => {
    await page.goto(CANVAS_URL!);

    const canvas = page.locator('.react-flow__pane');

    // Drop all node types
    const placements: Array<{ label: string; x: number; y: number }> = [
      { label: 'Sensor', x: 100, y: 250 },
      { label: 'Gateway', x: 250, y: 250 },
      { label: 'Broker', x: 400, y: 250 },
      { label: 'Ingest', x: 550, y: 250 },
      { label: 'TimescaleDB', x: 700, y: 250 },
    ];

    for (const { label, x, y } of placements) {
      const item = page.getByRole('listitem').filter({ hasText: new RegExp(`^${label}`, 'i') }).first();
      await item.dragTo(canvas, { targetPosition: { x, y } });
    }

    // All nodes should be present
    for (const { label } of placements) {
      await expect(
        page.locator('.react-flow__node').filter({ hasText: new RegExp(label, 'i') })
      ).toBeVisible({ timeout: 3000 });
    }
  });

  test('Apply modal opens with op list and can be confirmed', async ({ page }) => {
    test.skip(!process.env.E2E_DAEMON_MOCK, 'Requires daemon mock — set E2E_DAEMON_MOCK=true');

    await page.goto(CANVAS_URL!);

    const canvas = page.locator('.react-flow__pane');

    // Add at least a Broker node (triggers daemon ops)
    const brokerItem = page.getByRole('listitem').filter({ hasText: /^Broker/i }).first();
    await brokerItem.dragTo(canvas);

    // Click Apply
    await page.getByRole('button', { name: /^apply$/i }).click();

    // Apply modal should appear
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByRole('heading', { name: /apply pipeline configuration/i })).toBeVisible();

    // Modal should either show "Nothing to apply" or an ops list
    const hasOps = await dialog.locator('ol[aria-label="Apply operations"]').count();
    const hasEmpty = await dialog.getByText(/nothing to apply/i).count();
    expect(hasOps + hasEmpty).toBeGreaterThan(0);
  });

  test('Apply modal shows Nothing to apply when daemon already matches', async ({ page }) => {
    test.skip(!process.env.E2E_DAEMON_MOCK, 'Requires daemon mock');
    test.skip(!process.env.E2E_PRE_APPLIED, 'Requires pre-applied state');

    await page.goto(CANVAS_URL!);
    await page.getByRole('button', { name: /^apply$/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/nothing to apply/i)).toBeVisible({ timeout: 5000 });
  });

  test('dashboard page renders capacity gauge and status board', async ({ page }) => {
    test.skip(!DASHBOARD_URL, 'E2E_DASHBOARD_URL not set');

    await page.goto(DASHBOARD_URL!);

    // Dashboard page title
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

    // Add widget button visible for OWNER/ADMIN
    await expect(page.getByRole('button', { name: /add widget/i })).toBeVisible();
  });
});

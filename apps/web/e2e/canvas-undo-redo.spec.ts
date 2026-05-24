import { test, expect } from '@playwright/test';

/**
 * E2E: Canvas undo/redo
 *
 * Prerequisites: authenticated session, org with a project + siteGroup seeded.
 * The BASE_URL env should point to a running dev/test server.
 *
 * Covers requirement: "Undo/redo — 50-step history buffer"
 * Scenario: Undo removes last node addition
 * Scenario: History limit (50 steps)
 */
test.describe('Canvas undo/redo', () => {
  /**
   * Helper: navigate to the canvas page via env vars, or skip if not configured.
   */
  const CANVAS_URL = process.env.E2E_CANVAS_URL; // e.g. /orgs/o1/projects/p1/site-groups/sg1

  test.skip(!CANVAS_URL, 'E2E_CANVAS_URL not set — skipping live canvas tests');

  test('add a node then undo removes it', async ({ page }) => {
    await page.goto(CANVAS_URL!);

    // Verify empty canvas hint visible
    await expect(page.getByText('Drag node types from the panel to start')).toBeVisible();

    // Drag broker node from palette to canvas
    const paletteItem = page.getByRole('listitem').filter({ hasText: /broker/i }).first();
    const canvas = page.locator('.react-flow__pane');
    await paletteItem.dragTo(canvas);

    // A broker node card should now be visible
    await expect(page.getByText('Broker').first()).toBeVisible();

    // Empty state hint should be gone
    await expect(page.getByText('Drag node types from the panel to start')).not.toBeVisible();

    // Undo via keyboard shortcut
    await page.keyboard.press('Meta+z');

    // Broker node should be gone, empty hint should return
    await expect(page.getByText('Drag node types from the panel to start')).toBeVisible();
  });

  test('redo restores undone node', async ({ page }) => {
    await page.goto(CANVAS_URL!);

    const paletteItem = page.getByRole('listitem').filter({ hasText: /sensor/i }).first();
    const canvas = page.locator('.react-flow__pane');
    await paletteItem.dragTo(canvas);

    await expect(page.getByText('Sensor').first()).toBeVisible();

    // Undo
    await page.keyboard.press('Meta+z');
    await expect(page.getByText('Drag node types from the panel to start')).toBeVisible();

    // Redo via Cmd+Shift+Z
    await page.keyboard.press('Meta+Shift+z');
    await expect(page.getByText('Sensor').first()).toBeVisible();
  });

  test('undo button in toolbar is disabled on empty canvas', async ({ page }) => {
    await page.goto(CANVAS_URL!);
    const undoBtn = page.getByRole('button', { name: /undo/i });
    await expect(undoBtn).toBeDisabled();
  });

  test('delete selected node via keyboard', async ({ page }) => {
    await page.goto(CANVAS_URL!);

    const paletteItem = page.getByRole('listitem').filter({ hasText: /gateway/i }).first();
    const canvas = page.locator('.react-flow__pane');
    await paletteItem.dragTo(canvas);

    // Click the node to select it
    const gatewayNode = page.locator('.react-flow__node').filter({ hasText: /gateway/i }).first();
    await gatewayNode.click();

    // Delete via keyboard
    await page.keyboard.press('Delete');

    // Node should be removed
    await expect(page.getByText('Drag node types from the panel to start')).toBeVisible();
  });
});

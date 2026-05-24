import { test, expect } from '@playwright/test';

/**
 * E2E: Node palette drag-and-drop node creation
 *
 * Prerequisites: authenticated session, org with a project + siteGroup seeded.
 * Set E2E_CANVAS_URL to the siteGroup canvas route.
 *
 * Covers requirement: "Node palette sidebar — drag-and-drop node creation"
 * Scenario: Drag a node type from palette to canvas
 * Scenario: Fit view button
 */
test.describe('Node palette drag-and-drop', () => {
  const CANVAS_URL = process.env.E2E_CANVAS_URL;

  test.skip(!CANVAS_URL, 'E2E_CANVAS_URL not set — skipping live canvas tests');

  test('all 6 node types appear in the palette', async ({ page }) => {
    await page.goto(CANVAS_URL!);

    // Verify all 6 node type palette items are visible
    for (const label of ['Sensor', 'Gateway', 'Broker', 'Ingest', 'TimescaleDB', 'Monitoring']) {
      await expect(page.getByText(label).first()).toBeVisible();
    }
  });

  test('drag Broker from palette creates Broker card on canvas', async ({ page }) => {
    await page.goto(CANVAS_URL!);

    // Confirm empty state is shown
    await expect(page.getByText('Drag node types from the panel to start')).toBeVisible();

    const brokerItem = page.getByRole('listitem').filter({ hasText: /^Broker/i }).first();
    const canvas = page.locator('.react-flow__pane');

    await brokerItem.dragTo(canvas);

    // Broker node card rendered
    const brokerCard = page.locator('.react-flow__node').filter({ hasText: /broker/i });
    await expect(brokerCard).toBeVisible({ timeout: 3000 });

    // Empty state gone
    await expect(page.getByText('Drag node types from the panel to start')).not.toBeVisible();
  });

  test('double-click Broker node opens config dialog', async ({ page }) => {
    await page.goto(CANVAS_URL!);

    const brokerItem = page.getByRole('listitem').filter({ hasText: /^Broker/i }).first();
    const canvas = page.locator('.react-flow__pane');
    await brokerItem.dragTo(canvas);

    const brokerNode = page.locator('.react-flow__node').filter({ hasText: /broker/i });
    await brokerNode.dblclick();

    // Config dialog should appear
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 2000 });
    await expect(page.getByText('Broker kind')).toBeVisible();
    await expect(page.getByText('Throughput')).toBeVisible();
  });

  test('fit view button animates canvas to fit all nodes', async ({ page }) => {
    await page.goto(CANVAS_URL!);

    const canvas = page.locator('.react-flow__pane');

    // Add two nodes at different positions
    const sensorItem = page.getByRole('listitem').filter({ hasText: /sensor/i }).first();
    await sensorItem.dragTo(canvas, { targetPosition: { x: 100, y: 100 } });

    const tsdbItem = page.getByRole('listitem').filter({ hasText: /timescaledb/i }).first();
    await tsdbItem.dragTo(canvas, { targetPosition: { x: 600, y: 400 } });

    // Click fit view button
    const fitViewBtn = page.getByRole('button', { name: /fit view/i });
    await fitViewBtn.click();

    // Both nodes should still be visible after fit view
    await expect(page.locator('.react-flow__node').filter({ hasText: /sensor/i })).toBeVisible();
    await expect(page.locator('.react-flow__node').filter({ hasText: /timescaledb/i })).toBeVisible();
  });
});

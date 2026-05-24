import { test, expect } from '@playwright/test';

/**
 * E2E: Connection validation via CONNECTION_MATRIX
 *
 * Prerequisites: authenticated session, org with a project + siteGroup seeded.
 * Set E2E_CANVAS_URL to the siteGroup canvas route.
 *
 * Covers requirement: "Connection validation via CONNECTION_MATRIX"
 * Scenario: Invalid connection rejected with toast
 * Scenario: Valid connection accepted
 */
test.describe('Canvas connection validation', () => {
  const CANVAS_URL = process.env.E2E_CANVAS_URL;

  test.skip(!CANVAS_URL, 'E2E_CANVAS_URL not set — skipping live canvas tests');

  test('invalid connection TimescaleDB → Sensor shows toast and no edge created', async ({ page }) => {
    await page.goto(CANVAS_URL!);

    const canvas = page.locator('.react-flow__pane');

    // Drop TimescaleDB and Sensor nodes
    const tsdbItem = page.getByRole('listitem').filter({ hasText: /timescaledb/i }).first();
    const sensorItem = page.getByRole('listitem').filter({ hasText: /sensor/i }).first();
    await tsdbItem.dragTo(canvas, { targetPosition: { x: 200, y: 200 } });
    await sensorItem.dragTo(canvas, { targetPosition: { x: 400, y: 200 } });

    // Attempt to draw an edge from TimescaleDB output to Sensor input
    // This is done by dragging from the source handle of TSDB to the target handle of Sensor
    const tsdbNode = page.locator('.react-flow__node').filter({ hasText: /timescaledb/i });
    const sensorNode = page.locator('.react-flow__node').filter({ hasText: /sensor/i });

    // Get bounding boxes
    const tsdbBox = await tsdbNode.boundingBox();
    const sensorBox = await sensorNode.boundingBox();

    if (tsdbBox && sensorBox) {
      // Drag from right edge of TSDB (source handle) to left edge of Sensor (target handle area)
      await page.mouse.move(tsdbBox.x + tsdbBox.width, tsdbBox.y + tsdbBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(sensorBox.x, sensorBox.y + sensorBox.height / 2);
      await page.mouse.up();
    }

    // Toast notification should appear
    await expect(page.getByText(/cannot connect timescaledb.*sensor/i)).toBeVisible({ timeout: 3000 });

    // No edges should be present
    const edges = page.locator('.react-flow__edge');
    await expect(edges).toHaveCount(0);
  });

  test('valid connection Broker → Ingest is accepted', async ({ page }) => {
    await page.goto(CANVAS_URL!);

    const canvas = page.locator('.react-flow__pane');

    const brokerItem = page.getByRole('listitem').filter({ hasText: /broker/i }).first();
    const ingestItem = page.getByRole('listitem').filter({ hasText: /ingest/i }).first();
    await brokerItem.dragTo(canvas, { targetPosition: { x: 200, y: 200 } });
    await ingestItem.dragTo(canvas, { targetPosition: { x: 450, y: 200 } });

    const brokerNode = page.locator('.react-flow__node').filter({ hasText: /broker/i });
    const ingestNode = page.locator('.react-flow__node').filter({ hasText: /ingest/i });

    const brokerBox = await brokerNode.boundingBox();
    const ingestBox = await ingestNode.boundingBox();

    if (brokerBox && ingestBox) {
      // Drag from Broker's right handle (ingress source) to Ingest's left handle (ingress target)
      await page.mouse.move(brokerBox.x + brokerBox.width, brokerBox.y + brokerBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(ingestBox.x, ingestBox.y + ingestBox.height / 2);
      await page.mouse.up();
    }

    // Edge should be created (no error toast, edge element visible)
    const edges = page.locator('.react-flow__edge');
    await expect(edges).toHaveCount(1, { timeout: 3000 });
  });
});

import { chromium } from 'playwright';
import assert from 'assert';

async function runDemo(runNumber) {
  console.log(`\n============================`);
  console.log(`=== STARTING DEMO RUN ${runNumber} ===`);
  console.log(`============================\n`);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Reset demo state first
  const resetRes = await fetch('http://localhost:8000/api/demo/reset', { method: 'POST' });
  console.log(`Backend Reset: ${await resetRes.text()}`);

  // Listen to console logs
  const logs = [];
  page.on('console', msg => {
    console.log(`[Browser Console]: ${msg.text()}`);
    logs.push(msg.text());
  });

  // Load frontend
  console.log('Loading frontend...');
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000); // Wait for websocket connect

  // Trigger demo injection
  console.log('Triggering demo injection...');
  const injectRes = await fetch('http://localhost:8000/api/demo/inject', { method: 'POST' });
  console.log(`Injection Response: ${await injectRes.text()}`);

  // Wait for HITL panel
  console.log('Waiting for HITL Authorization Panel to appear...');
  const approveButton = page.locator('button:has-text("APPROVE")');
  await approveButton.waitFor({ state: 'visible', timeout: 30000 });
  console.log('HITL Panel appeared!');

  // Click APPROVE
  console.log('Clicking APPROVE...');
  await approveButton.click();

  // Wait for Maneuver Resolved state
  console.log('Waiting for Metrics Bar to show Resolved: 1...');
  const resolvedMetric = page.locator('text=Resolved: 1');
  await resolvedMetric.waitFor({ state: 'visible', timeout: 10000 });
  console.log('Maneuver successfully resolved and verified in MetricsBar!');

  await browser.close();
  console.log(`\n=== DEMO RUN ${runNumber} COMPLETED SUCCESSFULLY ===\n`);
}

async function main() {
  try {
    await runDemo(1);
    await runDemo(2);
    console.log("ALL TESTS PASSED: Demo ran cleanly twice in a row.");
  } catch (err) {
    console.error("TEST FAILED:", err);
    process.exit(1);
  }
}

main();

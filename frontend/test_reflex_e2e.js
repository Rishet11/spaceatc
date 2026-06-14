import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

async function runReflexTest() {
  console.log('Launching browser...');
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Set viewport size
  await page.setViewportSize({ width: 1440, height: 900 });

  // Navigate to dashboard
  console.log('Navigating to dashboard...');
  await page.goto('http://localhost:5173/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Take initial screenshot of Ground tab
  console.log('Taking screenshot of Ground Negotiation tab...');
  await page.screenshot({ path: '/Users/rishetmehra/.gemini/antigravity-ide/brain/5dcab51b-58bb-4f16-8bb6-c68842db0f01/ground_tab_initial.png' });

  // Locate and click the Onboard Reflex tab button
  console.log('Clicking Onboard Reflex tab...');
  const reflexTabButton = page.locator('button:has-text("Onboard Reflex")');
  await reflexTabButton.click();
  await page.waitForTimeout(2000);

  // Take screenshot of Reflex tab initial state
  console.log('Taking screenshot of Onboard Reflex tab (Initial)...');
  await page.screenshot({ path: '/Users/rishetmehra/.gemini/antigravity-ide/brain/5dcab51b-58bb-4f16-8bb6-c68842db0f01/reflex_tab_initial.png' });

  // Locate and click the Play button
  console.log('Clicking PLAY button...');
  const playButton = page.locator('button[title="Play"]');
  await playButton.click();

  // Let it run for 10 seconds to process a good chunk of frames
  console.log('Running playback and inference for 10 seconds...');
  await page.waitForTimeout(10000);

  // Take screenshot of active playback
  console.log('Taking screenshot of active Reflex dashboard...');
  await page.screenshot({ path: '/Users/rishetmehra/.gemini/antigravity-ide/brain/5dcab51b-58bb-4f16-8bb6-c68842db0f01/reflex_tab_active.png' });

  console.log('Closing browser...');
  await browser.close();
  console.log('Test completed successfully!');
}

runReflexTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

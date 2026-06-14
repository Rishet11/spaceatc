import { chromium } from 'playwright';
import path from 'path';

async function runUploadTest() {
  console.log('Launching browser...');
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Set viewport
  await page.setViewportSize({ width: 1440, height: 900 });

  // Navigate to dashboard
  console.log('Navigating to dashboard...');
  await page.goto('http://localhost:5173/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Switch to Onboard Reflex tab
  console.log('Switching to Onboard Reflex tab...');
  const reflexTabButton = page.locator('button:has-text("Onboard Reflex")');
  await reflexTabButton.click();
  await page.waitForTimeout(2000);

  // Perform upload of output_h264.mp4 as a custom stream test
  console.log('Uploading test video...');
  const fileChooserPromise = page.waitForEvent('filechooser');
  // Click the dropzone label (which triggers file selection)
  await page.locator('text=UPLOAD VIDEO STREAM').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles('/Users/rishetmehra/Desktop/Faraway/OrbitMind/output_h264.mp4');

  // Wait for upload loader to appear and then disappear
  console.log('Waiting for ingestion pipeline...');
  await page.waitForTimeout(4000); // give it time to process and trigger loader

  // Take screenshot of uploaded state (before play)
  console.log('Taking screenshot of uploaded state...');
  await page.screenshot({ path: '/Users/rishetmehra/.gemini/antigravity-ide/brain/5dcab51b-58bb-4f16-8bb6-c68842db0f01/upload_state_initial.png' });

  // Click Play
  console.log('Clicking PLAY button for custom stream...');
  const playButton = page.locator('button[title="Play"]');
  await playButton.click();

  // Let it play for 5 seconds
  console.log('Running playback on custom video...');
  await page.waitForTimeout(5000);

  // Take screenshot of custom playback
  console.log('Taking screenshot of custom playback...');
  await page.screenshot({ path: '/Users/rishetmehra/.gemini/antigravity-ide/brain/5dcab51b-58bb-4f16-8bb6-c68842db0f01/upload_state_playing.png' });

  // Click Reset Feed
  console.log('Clicking RESET FEED button...');
  const resetFeedButton = page.locator('button:has-text("RESET FEED")');
  await resetFeedButton.click();
  await page.waitForTimeout(2000);

  // Take final screenshot of reset state
  console.log('Taking screenshot of reset state...');
  await page.screenshot({ path: '/Users/rishetmehra/.gemini/antigravity-ide/brain/5dcab51b-58bb-4f16-8bb6-c68842db0f01/upload_state_reset.png' });

  console.log('Closing browser...');
  await browser.close();
  console.log('Upload E2E test completed successfully!');
}

runUploadTest().catch(err => {
  console.error('Upload E2E test failed:', err);
  process.exit(1);
});

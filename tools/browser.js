// Headless Chromium for the two tools that need a browser: tools/covers.js (each game's title screen, captured
// for its card) and tools/smoke.js. Playwright's own pinned build first; where that is missing, the Chromium the
// environment provides (PLAYWRIGHT_CHROMIUM, or /opt/pw-browsers/chromium) rather than downloading anything.
import fs from 'node:fs';
import { chromium } from 'playwright-core';

export async function launch(opts = {}) {
  try { return await chromium.launch(opts); }
  catch (e) {
    const exe = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
    if (fs.existsSync(exe)) return chromium.launch({ ...opts, executablePath: exe });
    throw new Error(`no Chromium for Playwright (${e.message.split('\n')[0]}); run: npx playwright-core install chromium`);
  }
}

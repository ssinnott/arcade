// Each card's picture is the game's own title screen, captured from the build that is about to ship.
//
// The game runs headless in its test mode (`?autotest=1&seed=1`: no sound, a fixed seed, and a loop that only moves
// when told), steps a second and a half so the title has settled into its idle, and the canvas is captured at
// twice its 640x360 so the card stays sharp on a high-density screen. A fixed seed and a fixed step count make the
// same build give the same picture, which keeps the offline cache's version steady between identical builds.
import fs from 'node:fs';
import path from 'node:path';
import { launch } from './browser.js';
import { createStaticServer } from './server.js';

const SETTLE_FRAMES = 90;

/** Write dist/games/<id>/cover.png for every game. */
export async function captureCovers(games, dist) {
  const server = createStaticServer(dist);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launch();
  try {
    for (const g of games) {
      const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 2 });
      await page.goto(`${base}/games/${g.id}/index.html?autotest=1&seed=1`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__game && window.__game.ready === true, null, { timeout: 20000 });
      const ok = await page.evaluate((n) => {
        if (typeof window.__game.step !== 'function') return false;
        window.__game.step(n);
        return true;
      }, SETTLE_FRAMES);
      const file = path.join(dist, 'games', g.id, 'cover.png');
      // A game without the test hooks still gets its first frame; one without a canvas gets no cover at all,
      // and its card shows the game's name instead.
      const canvas = page.locator('canvas').first();
      if (await canvas.count()) await canvas.screenshot({ path: file });
      console.log(`  cover games/${g.id}/cover.png${ok ? '' : ' (first frame: no __game.step)'}${fs.existsSync(file) ? '' : ' MISSING'}`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}


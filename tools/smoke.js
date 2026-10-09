// Smoke test for the built site (dist/), in headless Chromium, served under /arcade/ the way GitHub Pages serves it.
//
//   npm test            (after npm run build)
//
// What it holds the arcade to:
//   files    every game's page and cover, a manifest with its icons, and a worker that precaches all of it;
//   shelf    one card per game, each with its cover, and not one error in the console;
//   play     a card opens its game in a frame the game recognises as the arcade's (engine/arcade.ts in each game);
//            keys pressed on the page reach the game; the game's own way back returns to the shelf through history
//            and gives its card the focus again; a game that does not speak to the arcade ("bridge": false in
//            games.json) gets the shelf's own button instead, and one that does gets nothing drawn over it;
//   links    #<game>?query reaches the game's own location.search with its names lowered, a room hosted in the
//            arcade puts its invite in the arcade's address bar, and leaving a game opened by link shows the shelf;
//   offline  once the worker has installed, the shelf and every game open with the network off.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readGames } from './shelf.js';
import { ICONS, MANIFEST_PATH } from './pwa.js';
import { createStaticServer } from './server.js';
import { launch } from './browser.js';

const DIST = path.join(ROOT, 'dist');
const PREFIX = '/arcade/';
let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) passed++;
  else { failed++; console.log(`  FAIL: ${msg}`); }
}

function checkFiles(games) {
  for (const g of games) {
    assert(fs.existsSync(path.join(DIST, 'games', g.id, 'index.html')), `games/${g.id}/index.html is built`);
    assert(fs.existsSync(path.join(DIST, 'games', g.id, 'cover.png')), `games/${g.id}/cover.png is captured`);
  }
  assert(!fs.readFileSync(path.join(DIST, 'index.html'), 'utf8').includes('__GAMES__'), 'the shelf has its list inlined');
  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(path.join(DIST, MANIFEST_PATH), 'utf8')); } catch { /* asserted below */ }
  assert(!!manifest && manifest.start_url === './' && manifest.scope === './', 'the manifest parses and is scoped to the site');
  for (const icon of ICONS) {
    const file = path.join(DIST, icon.path);
    const png = fs.existsSync(file) ? fs.readFileSync(file) : null;
    assert(!!png && png.readUInt32BE(16) === icon.size && png.readUInt32BE(20) === icon.size, `${icon.path} is a ${icon.size}px PNG`);
  }
  const sw = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
  for (const g of games) assert(sw.includes(`./games/${g.id}/index.html`), `the worker precaches games/${g.id}`);
}

/** A fresh browser on the shelf (at `hash`), failing on any page or console error the page or its games raise. */
async function withShelf(base, fn, { hash = '', workers = false, errors: strict = true } = {}) {
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: workers ? 'allow' : 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  try {
    await page.goto(base + hash, { waitUntil: 'load' });
    await fn(page, context);
    if (strict) assert(errors.length === 0, `no errors on the page or in its games ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);
  } catch (e) {
    assert(false, `crashed: ${e.message.split('\n')[0]}`);
  } finally {
    await browser.close();
  }
}

/** The frame the shelf has a game in, once that game has booted. */
async function gameFrame(page) {
  await page.waitForSelector('#stage iframe', { timeout: 10000 });
  let frame = null;
  await page.waitForFunction(() => !!document.querySelector('#stage iframe').contentWindow, null, { timeout: 10000 });
  for (let i = 0; i < 100 && !frame; i++) {
    frame = page.frames().find((f) => f !== page.mainFrame() && /\/games\/[a-z0-9-]+\//.test(f.url())) || null;
    if (!frame) await page.waitForTimeout(100);
  }
  if (!frame) throw new Error('no game frame');
  await frame.waitForFunction(() => window.__game && window.__game.ready === true, null, { timeout: 20000 });
  return frame;
}

const shelfIsBack = (page) => page.waitForFunction(() => !document.querySelector('#stage iframe') && !document.getElementById('shelf').hidden, null, { timeout: 10000 });

async function main() {
  const games = readGames();
  if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('no dist/: run `npm run build` first');
  const server = createStaticServer(DIST, { prefix: PREFIX });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}${PREFIX}`;

  console.log('== files');
  checkFiles(games);

  console.log('== shelf');
  await withShelf(base, async (page) => {
    const ids = await page.$$eval('.card', (cs) => cs.map((c) => c.dataset.id));
    assert(ids.join() === games.map((g) => g.id).join(), `one card per game, in games.json order (${ids.join()})`);
    const covers = await page.$$eval('.card img', (imgs) => imgs.map((i) => i.complete && i.naturalWidth));
    assert(covers.length === games.length && covers.every((w) => w > 0), `every card shows its cover (${covers.join()})`);
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.dataset.id);
    assert(focused === games[0].id, `the first card has the focus, for a keyboard or a pad (${focused})`);
  });

  for (const g of games) {
    const bridged = g.bridge !== false;
    console.log(`== play ${g.id}`);
    await withShelf(base, async (page) => {
      await page.locator(`.card[data-id="${g.id}"]`).click();
      const frame = await gameFrame(page);
      assert(await page.evaluate(() => location.hash) === '#' + g.id, `${g.id}: the card's route is #${g.id}`);
      const name = await frame.evaluate(() => window.name);
      assert(name === `arcade:${base}#${g.id}?room=`, `${g.id}: the frame carries the arcade's name (${name})`);
      if (bridged) assert(await frame.evaluate(() => !!(window.__game.arcade && window.__game.arcade.active)), `${g.id}: the game recognises the arcade`);
      await page.waitForTimeout(2000);
      const button = await page.locator('#back').isVisible();
      assert(button === !bridged, bridged ? `${g.id}: nothing is drawn over a game with its own way back` : `${g.id}: a game without its own way back gets the shelf's button`);
      // Keys go to the page; they reach the game only because the shelf handed its frame the focus. Held as long as
      // a person holds one: the games read what is down once per 60 Hz step, and a 1 ms tap can fall between two.
      const before = await frame.evaluate(() => window.__game.screen());
      await page.keyboard.down('Enter');
      await page.waitForTimeout(80);
      await page.keyboard.up('Enter');
      await page.waitForTimeout(1000);
      const after = await frame.evaluate(() => window.__game.screen());
      assert(before === 'title' && after !== 'title', `${g.id}: Enter, pressed on the page, starts the game (${before} -> ${after})`);
      if (bridged) await frame.evaluate(() => window.__game.arcade.exit());
      else await page.locator('#back').click();
      await shelfIsBack(page);
      assert(await page.evaluate(() => location.hash) === '', `${g.id}: its way back is one step back in history, to the shelf`);
      const focused = await page.evaluate(() => document.activeElement && document.activeElement.dataset.id);
      assert(focused === g.id, `${g.id}: and its card has the focus again (${focused})`);
    });

    console.log(`== links ${g.id}`);
    // An invite read off a game's all-capitals screen and typed back in capitals still lands.
    await withShelf(base, async (page) => {
      const frame = await gameFrame(page);
      const search = await frame.evaluate(() => location.search);
      assert(search === '?room=BCDFGH&transport=broadcast', `${g.id}: the query reaches the game with its names lowered (${search})`);
      if (bridged) assert(await frame.evaluate(() => window.__game.screen()) === 'lobby', `${g.id}: and the game goes to its lobby to join`);
    }, { hash: `#${g.id.toUpperCase()}?ROOM=BCDFGH&TRANSPORT=broadcast` });
    if (!bridged) continue;
    await withShelf(base, async (page) => {
      const frame = await gameFrame(page);
      await page.waitForFunction((id) => new RegExp('^#' + id + '\\?room=[A-Z0-9]+$').test(location.hash), g.id, { timeout: 10000 }).catch(() => null);
      const hash = await page.evaluate(() => location.hash);
      assert(new RegExp(`^#${g.id}\\?room=[A-Z0-9]+$`).test(hash), `${g.id}: a room hosted in the arcade puts its invite in the address bar (${hash})`);
      await frame.evaluate(() => window.__game.arcade.exit());
      await shelfIsBack(page);
      assert(await page.evaluate(() => location.hash) === '', `${g.id}: leaving a game opened by link shows the shelf`);
    }, { hash: `#${g.id}?host=1&transport=broadcast` });
  }

  console.log('== offline');
  await withShelf(base, async (page, context) => {
    await page.evaluate(() => navigator.serviceWorker.ready);
    // Installing finishes the precache before the worker activates; a reload puts the shelf under it.
    await page.reload({ waitUntil: 'load' });
    assert(await page.evaluate(() => !!navigator.serviceWorker.controller), 'the worker controls the shelf');
    await context.setOffline(true);
    await page.reload({ waitUntil: 'load' });
    assert(await page.locator('.card').count() === games.length, 'with the network off, the shelf opens with every card');
    for (const g of games) {
      await page.evaluate((id) => { location.hash = '#' + id; }, g.id);
      const frame = await gameFrame(page).catch(() => null);
      assert(!!frame, `with the network off, ${g.title} still plays`);
      await page.evaluate(() => history.back());
      await shelfIsBack(page);
    }
  }, { workers: true, errors: false });

  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });

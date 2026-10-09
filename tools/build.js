// Build the arcade into dist/, which is the whole site:
//
//   dist/index.html                 the shelf: index.html with games.json inlined
//   dist/games/<id>/index.html      that game's own single-file build, byte for byte what its repository ships
//   dist/games/<id>/cover.png       its title screen, captured headless for its card (tools/covers.js)
//   dist/manifest.webmanifest, dist/sw.js, dist/icons/*.png
//                                   the installable app (tools/pwa.js), which caches all of the above
//
// Each game is built in its own submodule with its own tooling (`npm run build`), installing that game's
// dependencies first if it has none yet. Nothing about a game is changed on the way in.
//
//   node tools/build.js               build everything
//   node tools/build.js --no-covers   skip the browser; each card shows the game's name on its colours instead
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, readGames, renderShelf } from './shelf.js';
import { captureCovers } from './covers.js';
import { pwaAssets } from './pwa.js';

const DIST = path.join(ROOT, 'dist');
const covers = !process.argv.includes('--no-covers');

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed in ${path.relative(ROOT, cwd) || '.'}`);
}

const games = readGames();
fs.rmSync(DIST, { recursive: true, force: true });

for (const g of games) {
  const dir = path.join(ROOT, 'games', g.id);
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    throw new Error(`games/${g.id} is empty: run \`git submodule update --init\` first`);
  }
  if (!fs.existsSync(path.join(dir, 'node_modules'))) run('npm', ['ci', '--no-audit', '--no-fund'], dir);
  console.log(`\n== ${g.title} (games/${g.id})`);
  run('npm', ['run', 'build'], dir);
  const out = path.join(DIST, 'games', g.id);
  fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(path.join(dir, 'dist', 'index.html'), path.join(out, 'index.html'));
}

if (covers) await captureCovers(games, DIST);

const shelf = renderShelf(games);
fs.writeFileSync(path.join(DIST, 'index.html'), shelf);
for (const [rel, bytes] of pwaAssets(DIST, games)) {
  fs.mkdirSync(path.dirname(path.join(DIST, rel)), { recursive: true });
  fs.writeFileSync(path.join(DIST, rel), bytes);
}

console.log(`\nbuilt dist/: the shelf, ${games.length} games${covers ? ' with covers' : ''}, and the installable-app files`);
for (const g of games) {
  const kb = (fs.statSync(path.join(DIST, 'games', g.id, 'index.html')).size / 1024).toFixed(0);
  console.log(`  games/${g.id}/index.html  ${kb} KB`);
}

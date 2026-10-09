// The list of games and the page that shows them, shared by tools/build.js, tools/server.js and tools/smoke.js.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * games.json, checked. Every `id` is the game's folder under games/ (its submodule) and its route on the shelf
 * (#<id>), so it has to be safe in both. `bridge: false` marks a game that does not speak to the arcade
 * (engine/arcade.ts in each game): the shelf then draws its own way back over it, and the smoke test expects that.
 */
export function readGames() {
  const games = JSON.parse(fs.readFileSync(path.join(ROOT, 'games.json'), 'utf8'));
  if (!Array.isArray(games) || !games.length) throw new Error('games.json: expected a non-empty list of games');
  const seen = new Set();
  for (const g of games) {
    if (!/^[a-z0-9-]+$/.test(g.id || '')) throw new Error(`games.json: "${g.id}" is not a lower-case id`);
    if (seen.has(g.id)) throw new Error(`games.json: "${g.id}" is listed twice`);
    if (!g.title) throw new Error(`games.json: ${g.id} has no title`);
    seen.add(g.id);
  }
  return games;
}

/** The short commit a game's submodule is checked out at, or '' where that cannot be read. */
export function commitOf(id) {
  const r = spawnSync('git', ['-C', path.join(ROOT, 'games', id), 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

/** index.html with the list inlined where it says __GAMES__, stamped with the commit each game was built from. */
export function renderShelf(games) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  if (!html.includes('__GAMES__')) throw new Error('index.html: no __GAMES__ placeholder to inline the list into');
  // `<` escaped so nothing in a title or blurb can close the script element it is inlined into.
  const json = JSON.stringify(games.map((g) => ({ ...g, commit: commitOf(g.id) }))).replace(/</g, '\\u003c');
  return html.replace('__GAMES__', () => json);
}

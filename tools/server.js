// Static file server: the arcade's dev loop, and what tools/covers.js and tools/smoke.js serve dist/ with.
//
//   node tools/server.js [port]   http://localhost:8080/ - the shelf straight from index.html on disk, so an edit
//                                 shows on reload; everything else (the games, their covers, the icons) from the
//                                 last build in dist/. Run `npm run build` once first, and again after a game moves.
//                                 The worker served here caches nothing, so a reload is always what is on disk.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, readGames, renderShelf } from './shelf.js';
import { DEV_SW } from './pwa.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/**
 * Serve the folder `root` under the URL path `prefix`. GitHub Pages publishes the arcade under /arcade/, and the
 * smoke test serves it under the same prefix so a path that would break there breaks here first. `routes` answers
 * some paths itself: path after the prefix -> () => [content type, body].
 */
export function createStaticServer(root, { prefix = '/', routes = {} } = {}) {
  const base = path.resolve(root);
  return http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (!p.startsWith(prefix)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
    p = p.slice(prefix.length);
    if (p === '' || p.endsWith('/')) p += 'index.html';
    if (routes[p]) {
      const [type, body] = routes[p]();
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(body);
      return;
    }
    const file = path.resolve(base, p);
    const rel = path.relative(base, file);
    if (rel.startsWith('..') || path.isAbsolute(rel)) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found: ' + p); return; }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'Content-Length': data.length,
      });
      res.end(data);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || process.env.PORT || 8080);
  const dist = path.join(ROOT, 'dist');
  if (!fs.existsSync(path.join(dist, 'games'))) console.log('No build yet: run `npm run build` once, then reload.');
  createStaticServer(dist, {
    routes: {
      'index.html': () => ['text/html; charset=utf-8', renderShelf(readGames())],
      'sw.js': () => ['text/javascript; charset=utf-8', DEV_SW],
    },
  }).listen(port, () => console.log(`The Making Game Arcade dev server: http://localhost:${port}/`));
}

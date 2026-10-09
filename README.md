# The Making Game Arcade

One shelf for the games: [Foodie Truck](https://github.com/ssinnott/foodie-truck) and
[Aether & Brass](https://github.com/ssinnott/aether-and-brass), side by side in one web app you can install on a
phone and play with no network.

**Play:** <https://ssinnott.github.io/arcade/>, published from `main` by GitHub Actions.

**Support:** the games are free. If you want to chip in, <https://ko-fi.com/seansinnott>.

**On a phone:** open that link and add it to your home screen (Android's *Install app*, or Share → *Add to Home
Screen* on iOS). It opens on the shelf from its own icon, in landscape, with no browser chrome, and plays every game
offline: the whole arcade is a handful of single pages, and an installed copy keeps all of them.

## How it works

- **Each game is a git submodule** under `games/`, pinned to a commit. The build runs that game's own
  `npm run build` in its submodule and copies the single-file `dist/index.html` it makes into the site unchanged.
- **The shelf opens a game in a full-screen frame**: `#foodie-truck` shows `games/foodie-truck/`. Each game keeps
  its own window, so its keys, pads, sound and online play work exactly as on its own site, and closing the frame
  shuts all of it down. Saves carry over both ways, because the arcade and the games' own sites are all on
  `ssinnott.github.io`.
- **Inside the arcade, each game knows it.** Its title menu gains a last row, **BACK TO ARCADE**, and an online
  invite opens the arcade at that game instead of the bare page. On the game's own site nothing changes. The code is
  `src/engine/arcade.ts` in each game's repository; the contract is below.
- **Covers are the games' own title screens**, captured headless from the very build being shipped.

### Links

- `#<game>` opens a game, and anything after a `?` becomes that game's own query: `#foodie-truck?room=BCDFGH` joins
  that room. Names are lower-cased on the way in, so an invite read off a game's all-capitals screen and typed back
  in capitals still works.
- Host a room inside the arcade and the address bar becomes the invite, as it does on the game's own site.

### The contract between the arcade and a game

The shelf names each frame `arcade:` followed by its own link to that game with the room code left off, for example
`arcade:https://ssinnott.github.io/arcade/#foodie-truck?room=`. A game counts itself inside the arcade only when that
name is there **and** its parent page is on its own origin, so no other page that frames a game can switch any of
this on. The game then talks back with `postMessage` to that origin only:

| message | when | what the shelf does |
| --- | --- | --- |
| `{ type: 'arcade:hello' }` | at boot | keeps its own back button off the game: the game has a way back |
| `{ type: 'arcade:exit' }` | BACK TO ARCADE | returns to the shelf (one step back in history), which removes the frame |
| `{ type: 'arcade:room', room }` | a host's room opens | puts `#<game>?room=<room>` in the address bar |

A game that says nothing still plays. After a second and a half the shelf draws its own small **◀ ARCADE** button
over it. Mark such a game `"bridge": false` in `games.json` and the smoke test expects the button instead of the row.

## Development

```
git clone --recurse-submodules https://github.com/ssinnott/arcade
cd arcade
npm ci
npm run build      # each game built in its submodule (its dependencies installed first if missing), covers, dist/
npm run dev        # http://localhost:8080/ - the shelf from index.html on disk, everything else from dist/
npm test           # the smoke test, headless, against dist/ served under /arcade/ as Pages serves it
```

Node 22. Covers and the smoke test need Chromium (`npx playwright-core install chromium`), and
`node tools/build.js --no-covers` builds without it, with each card showing the game's name on its colours.

| file | what it is |
| --- | --- |
| `index.html` | the shelf: cards, routes, the frame, the messages, arrow keys and pads |
| `games.json` | the shelf's list: id (the submodule's folder), title, blurb, players, colours |
| `tools/build.js` | builds `dist/` |
| `tools/covers.js` | captures each game's title screen for its card |
| `tools/pwa.js`, `tools/icon.js` | manifest, offline worker, and icons drawn in code (nothing binary is committed) |
| `tools/smoke.js` | the smoke test |
| `tools/server.js` | the dev server, and the static server the covers and the smoke test use |

## Keeping the games current

The submodules follow each game's `main` (`branch = main` in `.gitmodules`). Once a day,
`.github/workflows/update-games.yml` moves every game to the tip of its `main`, builds the arcade and runs the smoke
test on that combination. If it passes, the move is committed to `main` and the site redeploys. If it fails, nothing
moves, and the failed run (GitHub emails it) names the game that broke the arcade. Run it from the Actions tab to
update straight away, or move a game by hand:

```
git submodule update --remote games/foodie-truck
git commit -am "Games: foodie-truck to the tip of main"
```

## Adding a game

1. `git submodule add -b main https://github.com/ssinnott/<repo>.git games/<id>`
2. Add it to `games.json`. The `id` is the folder name and the route (`#<id>`).
3. The game has to build to one self-contained `dist/index.html` with `npm run build`, and expose
   `window.__game` with `ready`, `step(n)` and `screen()` (which every game built on the shared engine does).
   For the menu row and the invites, copy `src/engine/arcade.ts` from either game and call `arcade.init()` at
   boot, or set `"bridge": false`. The smoke test expects ENTER on the title screen to move off it.

## Deployment

`.github/workflows/pages.yml` builds and smoke-tests every push and pull request, and deploys `main` to GitHub
Pages. That needs Pages switched on once: **Settings → Pages → Source: GitHub Actions**.

## License

MIT, as are the games.

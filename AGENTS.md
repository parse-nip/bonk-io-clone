# AGENTS.md

## Cursor Cloud specific instructions

### What this is

Single-service browser game (a bonk.io clone). Stack: Vite + TypeScript + Canvas 2D + **Planck.js (Box2D)**. **Online multiplayer** uses a Cloudflare Worker + Durable Objects relay (`worker/`) with host-authoritative physics; local dev proxies `/api` and `/ws` from Vite to wrangler on port `8787`.

### Commands (see `package.json` scripts)

- Run (dev, local only): `npm run dev` — Vite on port `5173` with `host: true`.
- Run (online multiplayer dev): `npm run dev:full` — wrangler on `8787` + Vite (proxies `/api` + `/ws`). Requires a `dist/` folder; `dev:server` creates a placeholder if missing.
- Deploy: `npm run deploy` — builds SPA to `dist/` then `wrangler deploy`.
- Typecheck / "lint": `npx tsc --noEmit` (there is no ESLint config). The full `npm run build` runs `tsc && vite build`; use it only when you need a production bundle.
- Headless smoke test: `npm run smoke` — runs `scripts/smoke.mjs`, a standalone Planck/Box2D sanity check (prints a JSON result). It does not import the app's own engine.

### Non-obvious gotchas

- **rAF pauses when the tab is not focused.** The game loop uses `requestAnimationFrame` (`src/main.ts`). Browsers throttle/pause rAF for background/unfocused tabs, so **screen recordings can look "frozen"** if the browser loses focus during capture. Keep the game tab foregrounded and keep interacting while recording, or the arena will appear stuck.
- **Player controls are continuous Box2D thrusters** (`applyForceToCenter` on Left/Right/Up/Down every frame). Feel is tuned to the OSU tutorial: mass **3**, thrust/weight ≈ **0.51** on every axis (`Fnety = Fy - mg`), map gravity ≈ **360**, near-elastic restitution, **no horizontal speed soft-cap** (momentum/coasts matter). Real HTML5 client gravity is `(0, 20)` in `js/alpha2s.js`. Heavy ≈ **2× density/mass**. Verify with `npm run test:movement` (includes coast + collision momentum).
- **Pixel-scale `Settings.maxTranslation`:** Planck/Box2D defaults to `maxTranslation = 2` per step. At 60 Hz that silently clamps `|v|` to **120**. Jump speeds above that get crushed every frame (felt mushy/floaty). `engine.ts` raises it for px/s gameplay.
- **Deterministic engine testing:** `src/game/engine.ts` (`BonkEngine`) is self-contained (only imports `planck` + local `maps`/`types` + protocol types). You can bundle it headlessly with the esbuild that ships inside Vite — e.g. `node_modules/.bin/esbuild src/game/engine.ts --bundle --format=esm --platform=node --outfile=/tmp/engine.mjs` — then import it in a Node script, call `addPlayers`/`startRound`/`setInput`/`update`, and assert on `player.body.position`. This is the most reliable way to test gameplay logic without the UI.
- **Round reset delay:** after all players fall off, the camera follows the falling bodies and the next round can take a while to reset. This is expected game behavior, not a hang.
- **Favicon 404** in the console is harmless (no favicon is served).
- **Online host tab must stay focused.** The host runs physics via rAF; if the host tab backgrounds, the match freezes for everyone.
- **Snapshots use Box2D body velocities** (`body.velocity.x/y` via the `PhysBody` adapter). Do not reintroduce kinematic tutorial integration for online play — it created an invisible full-width floor bounce and zeroed knockback.

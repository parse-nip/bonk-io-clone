# AGENTS.md

## Cursor Cloud specific instructions

### What this is

Single-service, client-only browser game (a bonk.io clone). Stack: Vite + TypeScript + Canvas 2D + `matter-js`. There is **no backend, no database, and no environment variables/secrets** — it's a static frontend served by Vite in dev.

### Commands (see `package.json` scripts)

- Run (dev): `npm run dev` — Vite dev server on port `5173` with `host: true` (see `vite.config.ts`). This is the command to use for development.
- Typecheck / "lint": `npx tsc --noEmit` (there is no ESLint config). The full `npm run build` runs `tsc && vite build`; use it only when you need a production bundle.
- Headless smoke test: `npm run smoke` — runs `scripts/smoke.mjs`, a standalone Matter.js physics sanity check (prints a JSON result). It does not import the app's own engine.

### Non-obvious gotchas

- **rAF pauses when the tab is not focused.** The game loop uses `requestAnimationFrame` (`src/main.ts`). Browsers throttle/pause rAF for background/unfocused tabs, so **screen recordings can look "frozen"** if the browser loses focus during capture. Keep the game tab foregrounded and keep interacting while recording, or the arena will appear stuck.
- **Player controls use the OSU bonk_v6 tutorial physics exactly** (`src/game/tutorialPhysics.ts`): `vx += deltaVx`, `x += vx*dt`, `Fnety = Fy - mass*g`, thrust `±15`, `mass=3`, `dt=0.1`, `g=9.8`. Matter.js handles collisions only (world gravity is off; tutorial integrates weight per player). Holding a direction on narrow maps still rolls you off quickly. Verify with `npm run test:movement`.
- **Deterministic engine testing:** `src/game/engine.ts` (`BonkEngine`) is self-contained (only imports `matter-js` + local `maps`/`types`). You can bundle it headlessly with the esbuild that ships inside Vite — e.g. `node_modules/.bin/esbuild src/game/engine.ts --bundle --format=esm --platform=node --outfile=/tmp/engine.mjs` — then import it in a Node script, call `addPlayers`/`startRound`/`setInput`/`update`, and assert on `player.body.position`. This is the most reliable way to test gameplay logic without the UI.
- **Round reset delay:** after all players fall off, the camera follows the falling bodies and the next round can take a while to reset. This is expected game behavior, not a hang.
- **Favicon 404** in the console is harmless (no favicon is served).

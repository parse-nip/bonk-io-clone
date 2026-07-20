# AGENTS.md

## Cursor Cloud specific instructions

### What this is

Browser bonk.io clone with optional online multiplayer.

- **Client:** Vite + TypeScript + Canvas 2D + `matter-js` (`src/`)
- **Realtime backend:** Cloudflare Worker + Durable Objects (`worker/`, `shared/protocol.ts`)
- **Deploy target:** `bonk.popped.dev`

Local/offline Quick Play still works with no Worker. Online Multiplayer needs `wrangler dev` or a deploy.

### Commands (see `package.json` scripts)

- Client only: `npm run dev` — Vite on `5173` (proxies `/api` + `/ws` → `8787`)
- Worker only: `npm run dev:server` — `wrangler dev --port 8787`
- Full local stack: `npm run dev:full`
- Typecheck / build: `npm run build` (`tsc && vite build`) — does **not** typecheck `worker/` (Wrangler bundles that)
- Deploy: `npm run deploy` (build + `wrangler deploy`)
- Headless smoke: `npm run smoke`
- Movement regression: `npm run test:movement`

### Architecture notes

- **Host-authoritative:** the host browser runs `BonkEngine`; the DO relays inputs → host and snapshots → peers.
- **Clients** do not step Matter.js; they `applySnapshot` + interpolate (`src/net/interpolate.ts`).
- Room list lives in Durable Object `LobbyDirectory` (`idFromName("global")`).
- Custom domain is configured in `wrangler.toml` (`bonk.popped.dev`). Deploy fails to attach the domain if the zone is not in the same CF account — remove/comment the `[[routes]]` block to ship on `*.workers.dev` first.

### Non-obvious gotchas

- **rAF pauses when the tab is not focused.** Host tab throttle freezes the match for everyone online. Keep the host tab focused.
- **Player controls work, but the human rolls off fast** on narrow maps — often misread as “no movement.”
- **Deterministic engine testing:** bundle `src/game/engine.ts` with esbuild for Node tests (see prior notes).
- **Favicon 404** is harmless.
- Cloudflare MCP deploy/bindings may need desktop auth; CLI deploy needs `CLOUDFLARE_API_TOKEN` / `wrangler login`.

# bonk · popped.dev

A high-fidelity browser clone of [bonk.io](https://bonk.io/) — multiplayer physics arena where circular players knock each other off the map.

**Live target:** [https://bonk.popped.dev](https://bonk.popped.dev)

## Research

- [`docs/RESEARCH_NOTES.md`](docs/RESEARCH_NOTES.md) — original game research
- [`docs/MULTIPLAYER_RESEARCH.md`](docs/MULTIPLAYER_RESEARCH.md) — responsive netcode + Cloudflare design
- [`docs/LEARNING_CHECKLIST.md`](docs/LEARNING_CHECKLIST.md) — teach-back checklist

## Play locally

```bash
npm install
npm run dev:full   # Vite :5173 + wrangler :8787 (proxied /api + /ws)
```

Or separately: `npm run dev:server` then `npm run dev`.

Open the Vite URL. Use **Online Multiplayer** to create/join rooms (needs the Worker). **Quick Play** still works offline with bots.

## Deploy (Cloudflare)

Requires the `popped.dev` zone in your Cloudflare account (for the custom domain).

```bash
npm run deploy
```

This builds the Vite SPA into `dist/`, then `wrangler deploy` publishes:

- Static assets + SPA fallback
- `/api/rooms`, `/api/health`
- `/ws` → Durable Object `GameRoom`
- Custom domain `bonk.popped.dev`

## Features

- **Online multiplayer** via Cloudflare Durable Objects (host-authoritative physics, ~20 Hz snapshots, client interpolation)
- **UI shell** matching bonk.io: guest/login, brown menu buttons, top bar, logo wordmark
- **Classic / Arrows / Death Arrows / Grapple / Football** modes
- **Matter.js** physics with heavy mode (X / Space / Shift)
- **Quick Play** + local bots; **Local 2-player** (Arrows + WASD)
- **Skin editor** + simplified **map editor**

## Controls

| Action | Player 1 | Player 2 (local) |
|--------|----------|------------------|
| Move | Arrow keys | WASD |
| Jump | ↑ | W |
| Heavy | X / Space / Shift | C |
| Special (Arrows / Grapple) | Z / Y | V |

## Stack

Vite · TypeScript · Canvas 2D · Matter.js · Cloudflare Workers · Durable Objects

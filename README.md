# bonk.io clone

A high-fidelity browser clone of [bonk.io](https://bonk.io/) — multiplayer physics arena where circular players knock each other off the map.

## Research

See [`docs/RESEARCH_NOTES.md`](docs/RESEARCH_NOTES.md) (20+ minutes of pre-implementation research) and [`docs/LEARNING_CHECKLIST.md`](docs/LEARNING_CHECKLIST.md) for the teach-back checklist.

## Play

```bash
npm install
npm run dev
```

Open the local URL Vite prints (default `http://localhost:5173`).

## Features

- **UI shell** matching bonk.io: guest/login, brown menu buttons, top bar, logo wordmark, recorded-match style background
- **Classic / Arrows / Death Arrows / Grapple / Football** modes
- **Matter.js** physics with heavy mode (X / Space / Shift)
- **Quick Play** + **Custom Game** lobbies with AI bots
- **Local 2-player** (Arrows + WASD)
- **Skin editor** (base colour, accent, eyes/mouth)
- **Simplified map editor** with playtest
- Built-in maps including **Classic** (rotating lime platform)

## Controls

| Action | Player 1 | Player 2 |
|--------|----------|----------|
| Move | Arrow keys | WASD |
| Jump | ↑ | W |
| Heavy | X / Space / Shift | C |
| Special (Arrows / Grapple) | Z / Y | V |

## Stack

Vite · TypeScript · Canvas 2D · Matter.js

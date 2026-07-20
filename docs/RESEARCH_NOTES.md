# Bonk.io Clone — Research Notes

Research window: ~20 minutes before implementation (2026-07-19).

## Sources reviewed
- Official site: https://bonk.io/ and gameframe-release.html
- Mechanics writeups: bonk-io.com/blog/how-bonk-io-works/
- Wiki: bonkio.fandom.com (Main menu, HTML5 version, Quick Play, Skins, Editor, Custom Game, Classic map)
- Archive wiki: Controls, overview
- NamuWiki Bonk.io deep dive (modes, editor properties, keybinds)
- DemystifyBonk (map format, network packets, input bitfield)
- Remakes: QuickToBeSlow/Bonk_Remake (Box2D), Sopur/bonkai
- Wikibooks: Physics Explained Through a Video Game (Box2D confirmation)
- Visual references: main menu PNG, Classic (Chaz) map PNG, skin editor PNG

## Core game loop
1. Up to 8 circular players on a platform arena
2. Move with arrow keys (or WASD); jump with Up
3. Hold X / Space / heavy key → increase mass (~2×), reduce acceleration
4. Collide to knock others off; falling past map bounds = eliminated
5. Last player standing wins the round; first to N wins wins the match

## Physics (must-feel)
- Real 2D rigid-body feel: mass, momentum, friction, angular velocity
- Original uses Box2D-derived / custom server-authoritative sim @ ~60 Hz
- Circle hitboxes (skin does not change collision)
- High friction relative to real world (balls slow after contact)
- Heavy: activate ~200–300 ms before contact, release after
- Walls/platforms ≈ infinite mass; bounce preserves more energy than ball-ball
- Map scale via `ppm` (pixels-per-meter style); default blank map `ppm: 12`
- Platform defaults from map format: friction ~0.3, restitution ~0.8, density ~0.3

## Input bitfield (from DemystifyBonk)
`Left=1, Right=2, Up=4, Down=8, Heavy=16, Special=32`

## Modes
| Mode | Mechanic |
|------|----------|
| Classic | Pure knock-off; heavy with X |
| Arrows | Hold Z/special to charge arrow; L/R aim; can't strafe while aiming; release fire |
| Death Arrows | Same as Arrows but arrows kill on hit |
| Grapple | Special attaches rope to nearest surface; hit while grappling knocks off |
| Football | No gravity on players; X kicks ball into opposing goal |

Quick Play offers Classic / Arrows / Grapple. Custom Game can pick any mode + map + rounds + teams.

## UI / visual identity (1:1 targets)
- Fixed game viewport (~730×500 feel) centered on dark page
- Charcoal/dark gray playfield background (#2b2b2b-ish)
- Top chrome bar: logo text, username, friends, skin preview circle, settings
- Stack of sandy-brown rectangular menu buttons (Quick Play, Custom Game, Skin, Friends, Settings)
- Bottom branding: “Chaz presents” + green outlined `bonk.io` wordmark
- Login / Guest entry before main menu
- Menu background: looping recorded match footage (we’ll simulate with canvas replay / animated platforms)
- Classic map: lime-green rounded rectangle platform that can rotate under weight (revolute joint + angular damping)
- Players: colored disks with optional layered shapes (eyes/mouth from skin layers)
- Lobby: player list with ready checks, team colors (FFA/R/B/G/Y/spec), map preview, host Start

## Map system (simplified for clone)
Bodies (`s` stationary / `d` dynamic / `k` kinematic), fixtures, shapes (`bx`/`ci`/`po`), joints (revolute, distance, etc.), spawns, cap zones, death fixtures.

Built-in maps to ship:
1. Classic (Chaz) — rotating lime platform
2. Flat Arena — wide static platform
3. Twin Towers — two pillars
4. Narrow Beam — thin high-friction beam
5. Circles — circular platforms
6. Football Pitch — goals + ball (Football mode)

## Multiplayer approach for this clone
True bonk.io is server-authoritative WebSocket rooms. This repo now supports both:
- Local host simulation with AI bots (Quick Play) + optional 2nd local player (WASD)
- **Online:** Cloudflare Durable Object rooms, host-authoritative Matter.js, input bitfields + snapshot interpolation (see `docs/MULTIPLAYER_RESEARCH.md`)
- Custom Game / Online lobby UI with host controls
- Same round/score flow as real game

## Design decisions for the clone
- **Matter.js** instead of raw Box2D WASM: faster to ship, same circle/rect/joint primitives, tunable to feel close
- **Vanilla TS + Vite + Canvas**: matches HTML5 bonk stack simplicity; no React cards/dashboard chrome
- **Faithful brown/charcoal UI**, not a modern redesign
- Scope: full Classic feel + Arrows + Grapple + skin color editor + basic map editor + lobbies; not full community map DB / ranked leagues

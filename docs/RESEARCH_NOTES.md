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
- Original HTML5 uses Box2D-derived / custom server-authoritative sim @ ~60 Hz
- **Confirmed from client (`js/alpha2s.js`):** world gravity hard-coded to `(0, 20)`
- **Disc fixture (client):** density ≈ `0.001337`, restitution ≈ `0.95`; body linearDamping ≈ `0.01`
- Circle hitboxes (skin does not change collision); player radius in map units = `ppm` (default 12)
- Continuous thrusters on arrow keys (all 4 directions), not grounded jump
- High platform friction relative to real world; player–player bounce is energetic
- Heavy: ~2× mass, reduced acceleration; activate ~200–300 ms before contact, release after
- Walls/platforms ≈ infinite mass when stationary; bounce preserves more energy than soft materials
- Map scale via `ppm` (pixels-per-meter style); default blank map `ppm: 12`
- Platform defaults from map format: friction ~0.3, restitution ~0.8, density ~0.3

### Clone mapping (Planck.js / Box2D) — updated 2026-07-21
- Map coords == Box2D meters (~780×520), same convention as bonk map units
- World gravity from map def (builtins use `y: 18–22`, football `0`; client default `(0, 20)`)
- Disc: density `0.001337`, restitution `0.95`, linearDamping `0.01`, angularDamping `3.4`, radius `12`
- `applyForceToCenter` thrusters every frame; thruster ≈ 78% of light weight (no flight)
- Heavy = 2× fixture density; soft speed caps kept high for freefall kills
- Do **not** use OSU tutorial kinematic integrator in the live engine (invisible floor + dead knockback)
- Confirmed live in obfuscated client `https://bonk.io/js/alpha2s.js`: `new …(new …(0,20))` world ctor + fixture `0.001337` / `0.95`

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

## Map Editor (research pass 2026-07-20)

Sources: bonkio.fandom.com (Editor, Editor Elements, Editor Preview, Editor Properties, Platforms, Spawn, Capture Zone), bonkioextended.fandom.com Map Editor, NamuWiki Bonk.io §3.3, DemystifyBonk Packets.md map envelope.

### Original HTML5 editor layout (3 panels)
1. **Elements** (left): collapsible Platforms / Spawns / Capture Zones; color bar; + / delete / duplicate / up / down
2. **Preview** (center): undo/redo, map props gear, grid, fit/zoom, start/stop preview, play-from-editor; New / Load / Save; physical shape count + info box
3. **Properties** (right): per-element settings, or Map Properties when gear active

### Platform property groups (original)
- **Basic:** Move Type (Stationary / Free Moving / Kinematic), X/Y, Angle, Bounciness, Density, Friction, Fric Players, Anti Tunnel, Collide Group/With
- **Movement (free/kinematic):** Start Speed, Start Spin, Linear/Rotational Drag, Fixed Rotation, Apply Force, Force Direction, Torque
- **Joints (free):** Rotating, Soft Rod, Follows Path, Springy (+ break force, draw line, attach)
- **Shapes:** Circle / Rectangle / Polygon; Shrink, No Physics, No/Inner Grapple, Death; per-shape physics overrides; duplicate invert X/Y

### Clone editor scope (this PR)
Implemented UI parity for the three panels + New/Load/Save/Export/Play, undo/redo, grid/zoom/pan, platforms (box/circle/polygon), spawns (teams/priority/start speed), capture zones (stored + drawn), map props (size presets, gravity, kill bounds), move types Stationary / Free / Rotating-pivot, Death, No Physics, and localStorage persistence.

Deferred vs original (physics complexity): full Kinematic move type, Soft Rod / Follows Path / Springy joints, collide groups, force zones, shrink-over-time, grapple-specific flags, online publish/community DB.

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
True bonk.io is server-authoritative WebSocket rooms. For this repo:
- Local host simulation with AI bots (Quick Play)
- Optional 2nd local player (WASD)
- Custom Game lobby UI with bot fill + host controls
- Same round/score flow as real game

## Design decisions for the clone
- **Planck.js (Box2D)** — same family as HTML5 bonk’s box2dweb / Box2DFlash stack; constants taken from the live client
- **Vanilla TS + Vite + Canvas**: matches HTML5 bonk stack simplicity; no React cards/dashboard chrome
- **Faithful brown/charcoal UI**, not a modern redesign
- Scope: full Classic feel + Arrows + Grapple + skin color editor + basic map editor + lobbies; not full community map DB / ranked leagues

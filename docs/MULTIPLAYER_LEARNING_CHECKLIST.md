# Online Multiplayer — Learning Checklist

Use this to verify you understand the IP multiplayer implementation.

## 1. The problem

- [ ] **Why** can't two browsers share one `BonkEngine` directly?
- [ ] **Why** host-authoritative physics (vs peer-to-peer)?
- [ ] **Why** snapshots must carry `tutorial.vx/vy`, not Matter `body.velocity`?

## 2. Architecture

- [ ] Worker routes: `/api/rooms` → Lobby DO, `/ws` → GameRoom DO
- [ ] Host runs `engine.update()`; clients run `applySnapshot()` + interpolate
- [ ] Input travels as a **bitfield** (`packInput` / `unpackInput`)
- [ ] Snapshots broadcast ~20 Hz from host via `net.sendSnapshot()`

## 3. Dev workflow

- [ ] `npm run dev:full` = wrangler `:8787` + Vite (proxy `/api`, `/ws`)
- [ ] Menu → **Online Multiplayer** → Create / Join by code
- [ ] **Local only** = offline lobby with bots (unchanged)

## 4. Edge cases

- [ ] Host tab unfocused → rAF pauses → match freezes for everyone
- [ ] Client waits for interpolated snapshot before drawing physics
- [ ] `dist/` placeholder needed for wrangler dev before first `npm run build`

## 5. Broader impact

- [ ] Local Quick Play unchanged
- [ ] Map editor stays client-only (custom maps not synced online yet)
- [ ] Deploy: `npm run build && wrangler deploy`

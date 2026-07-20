# Responsive Multiplayer + Cloudflare — Research Notes

Research date: 2026-07-20. Goal: real multiplayer for the bonk clone, deployed at `bonk.popped.dev`.

## What “responsive” means for a physics arena

Players feel input lag when:

1. Their keypress waits for a round-trip before the ball moves (server RTT / 2).
2. Remote players teleport instead of sliding (no interpolation).
3. The sim ticks irregularly (variable dt / no fixed step on the authority).

Industry pattern for competitive physics (bonk.io, many indie arena games):

| Layer | Rate | Role |
|-------|------|------|
| Authority tick | ~60 Hz fixed | Apply inputs → step physics → decide eliminations |
| Input stream | 30–60 Hz | Clients send **intent** (bitfield), not outcomes |
| Snapshots | 15–30 Hz | Authority broadcasts positions / velocities / round state |
| Client render | 60 FPS | Interpolate between buffered snapshots |

Techniques that hide latency:

- **Authoritative simulation** — one source of truth (server *or* designated host). Prevents desync and most cheating.
- **Client-side prediction** — local player moves immediately; reconcile when authority snapshot arrives.
- **Entity interpolation** — remotes render ~100ms in the past between two snapshots (smooth, not snappy-wrong).
- **Input bitfields** — small packets (`Left=1, Right=2, Up=4, …`) like real bonk / DemystifyBonk.

## Architecture branches we considered

### A) Full server-authoritative Matter.js inside a Durable Object

- Pros: fair, host leave doesn’t kill the match, matches real bonk.
- Cons: Matter.js CPU on DO duration billing; need to port `setTimeout` round resets to alarms; larger Worker bundle; harder to debug.

### B) Host-authoritative + Durable Object as WebSocket room relay ← **chosen**

- Pros: reuses existing `BonkEngine` / Matter.js; low DO CPU (relay + lobby only); ships faster; still feels responsive for the host and good on Cloudflare’s edge for clients.
- Cons: host can cheat / has zero input lag advantage; if host disconnects, match ends (or we migrate host — future work).

### C) Peer-to-peer WebRTC

- Pros: lowest latency between peers.
- Cons: NAT traversal pain, no central lobby, Cloudflare custom domain story is weaker for signaling alone.

## Why Cloudflare Workers + Durable Objects

- **One DO instance = one game room** — natural single-threaded coordinator (lobby, broadcast, host election).
- **Hibernation WebSockets** — connections stay open while idle lobby rooms sleep (cheaper).
- **Static Assets** on the same Worker — SPA + `/api` + `/ws` on `bonk.popped.dev` with one deploy.
- **Custom Domains** — `routes = [{ pattern = "bonk.popped.dev", custom_domain = true }]` attaches DNS + certs when the zone is on Cloudflare.

## Protocol (v1)

Clients send: `join` / `create` / `ready` / `start` / `input` / `snapshot` (host) / `chat` / `leave`.

Server relays: `welcome`, `lobby`, `started`, `input` (to host), `snapshot` (to all), `rooms`, `error`, `peer_left`.

Host runs bots + physics; non-hosts send inputs and render interpolated snapshots.

## Deploy target

- Worker name: `bonk`
- Domain: `bonk.popped.dev` (requires `popped.dev` zone in the same Cloudflare account)
- Local: Vite on `:5173` proxies `/api` + `/ws` → `wrangler dev` on `:8787`

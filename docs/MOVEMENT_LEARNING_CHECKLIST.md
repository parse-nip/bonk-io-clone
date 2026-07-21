# Movement Physics — Understanding Checklist

Use this to verify you understand why movement was wrong and what 1:1 means here.

## 1) The problem
- [ ] Players were driven by **kinematic tutorial physics** (`tutorialPhysics.ts`) with Matter gravity set to **0**.
- [ ] The tutorial bounce ran when `0 < x < map.width` — a **full-width invisible floor**.
- [ ] That floor sat at `floorMatterY`, so you **could not fall** past a certain Y into the kill zone.
- [ ] Zeroing Matter velocity every frame killed rigid-body knockback → movement felt **slow / floaty**.
- [ ] A later Matter.js thruster port still used scaled gravity (`scale: 0.001`) instead of real Box2D units.
- [ ] The OSU `bonk_v6` sketch is a teaching toy, **not** HTML5 bonk.io (which is Box2D).

## 2) What real bonk does (research from `js/alpha2s.js` + community)
- [ ] Client creates a Box2D world with gravity **`(0, 20)`**.
- [ ] Player is a **disc**; fixture density ≈ **0.001337**, restitution ≈ **0.95**.
- [ ] Disc body: **linearDamping ≈ 0.01**, **angularDamping ≈ 3.4**.
- [ ] Player radius in map units equals **`ppm`** (default **12**).
- [ ] Controls are **continuous thrusters** on Left/Right/Up/Down (`ApplyForce`), not a grounded jump.
- [ ] **Heavy** roughly **doubles density/mass** and cuts acceleration / maneuverability.
- [ ] Platform defaults: friction ~0.3, restitution ~0.8, density ~0.3.

## 3) The solution in this clone
- [ ] Physics engine is **Planck.js** (Box2D), not Matter.js.
- [ ] `applyForceToCenter` thrusters on Left/Right/Up/Down every frame — **same |F|** on every axis like the tutorial (`Fx/Fy = ±15`, `Fnety = Fy - mass·g`).
- [ ] Tutorial ratios: mass **3**, radius **25**, thrust/weight = **15/(3·9.8)≈0.51**, map gravity ≈ **360** (tutorial `dt=0.1` @ 60fps ≈ 6× time — raw client `g=20` feels sluggish in real-time).
- [ ] **Momentum**: no horizontal speed soft-cap; linearDamping **0.01**; restitution **~0.94** (tutorial floor does `vy = -vy`). Soft-caps / heavy air drag were killing coasts and knockback.
- [ ] Grounded hop after `world.step` + clear stale contacts (Box2D resting contacts won’t start a bounce alone); `Settings.maxTranslation` raised for pixel speeds.
- [ ] Heavy = **2× density** (wiki: more bash momentum, much less maneuverable).
- [ ] Off a platform edge → real freefall past `killY` → elimination.
- [ ] Snapshots carry **Box2D** velocities (needed for knockback online).
- [ ] `PhysBody` adapts Planck bodies for renderer / tests.

## 4) Broader context
- [ ] Matter was a stand-in; shipping Box2D matches the original client’s solver and constants.
- [ ] `tutorialPhysics.ts` remains for study (`npm run test:tutorial`) but is **not** the game loop.
- [ ] `npm run test:movement` asserts thrusters, fall-off, **collision momentum**, and heavy slowdown.

## Quiz yourself
1. Why did `state.x > 0 && state.x < width` prevent falling off Flat Arena?
2. With Box2D gravity `y: 20` and disc mass ≈ `0.605`, what is weight? Why must thruster stay **below** that?
3. Why must snapshots send body velocity instead of zeros after a kinematic step?
4. What Box2D gravity vector does the real HTML5 client hard-code?
5. Why does disc restitution `0.95` make `settle()` need many frames before tests plant the player?
6. At 60 Hz with `maxTranslation = 2`, what is the max `|v|` Box2D allows? What happens to a `JUMP_SPEED` of 180?
7. Why is vertical thruster weaker than horizontal in this clone?

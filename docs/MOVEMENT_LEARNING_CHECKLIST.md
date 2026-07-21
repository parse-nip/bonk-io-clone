# Movement Physics — Understanding Checklist

Use this to verify you understand why movement was wrong and what 1:1 means here.

## 1) The problem
- [ ] Players were driven by **kinematic tutorial physics** (`tutorialPhysics.ts`) with Matter gravity set to **0**.
- [ ] The tutorial bounce ran when `0 < x < map.width` — a **full-width invisible floor**.
- [ ] That floor sat at `floorMatterY`, so you **could not fall** past a certain Y into the kill zone.
- [ ] Zeroing Matter velocity every frame killed rigid-body knockback → movement felt **slow / floaty**.
- [ ] The OSU `bonk_v6` sketch is a teaching toy, **not** HTML5 bonk.io (which is Box2D).

## 2) What real bonk does (research)
- [ ] Client creates a Box2D world with gravity **`(0, 20)`** (confirmed in `alpha2s.js`).
- [ ] Player is a **disc**; fixture density ≈ **0.001337**, restitution ≈ **0.95**.
- [ ] Player radius in map units equals **`ppm`** (default **12**) — kklee / DemystifyBonk.
- [ ] Controls are **continuous thrusters** on Left/Right/Up/Down (not a grounded jump).
- [ ] **Heavy** roughly **doubles mass** and cuts acceleration / maneuverability.
- [ ] Platform defaults: friction ~0.3, restitution ~0.8, density ~0.3.

## 3) The solution in this clone
- [ ] Matter.js thrusters: `applyForce` on Left/Right/Up/Down every frame.
- [ ] Map gravity on: `gravity: { x, y, scale: 0.001 }` from the map def.
- [ ] Disc-like player: restitution **0.95**, low friction, air drag ~0.01.
- [ ] `HEAVY_MASS = 2× BASE_MASS`; weaker `HEAVY_MOVE_FORCE`.
- [ ] Soft speed caps keep continuous thrust readable.
- [ ] Off a platform edge → real freefall past `killY` → elimination.
- [ ] Snapshots carry **Matter** `body.velocity` (needed for knockback online).

## 4) Broader context
- [ ] Matter is a stand-in for Box2D; units are scaled for pixel maps, model is the same.
- [ ] `tutorialPhysics.ts` remains for study (`npm run test:tutorial`) but is **not** the game loop.
- [ ] `npm run test:movement` asserts thrusters, fall-off, **collision momentum**, and heavy slowdown.

## Quiz yourself
1. Why did `state.x > 0 && state.x < width` prevent falling off Flat Arena?
2. With Matter gravity `y: 1.2` and `scale: 0.001`, what weight does mass `1` feel? Why is `MOVE_FORCE ≈ 0.00138`?
3. Why must snapshots send body velocity instead of zeros after a kinematic step?
4. What Box2D gravity vector does the real HTML5 client hard-code?

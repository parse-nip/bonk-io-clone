# Movement Fix — Understanding Checklist

Use this to verify you understand why movement felt cooked and what we changed.

## 1) The problem
- [ ] Players were driven by **kinematic tutorial physics** (`tutorialPhysics.ts`) with Matter gravity set to **0**.
- [ ] The tutorial bounce ran when `0 < x < map.width` — a **full-width invisible floor**.
- [ ] That floor sat at `floorMatterY` (top of platforms, or `height - 40` on Classic), so you **could not fall past a certain Y** into the kill zone.
- [ ] Zeroing Matter velocity every frame also killed real rigid-body knockback / gravity feel → movement felt **slow / floaty / low-g**.

## 2) The solution
- [ ] Restore **Matter.js thrusters**: `applyForce` on Left/Right/Up/Down every frame.
- [ ] Map gravity is back: `gravity: { x, y, scale: 0.001 }` from the map def.
- [ ] `MOVE_FORCE` stays **below** map weight (~0.0012) so Up slows a fall / shapes bounces but cannot sustain flight (same ratio idea as tutorial thrust 15 < mass×g 29.4).
- [ ] Soft speed caps (`MAX_SPEED` / `HEAVY_MAX_SPEED`) keep continuous thrust readable.
- [ ] Off a platform edge → real freefall past `killY` → elimination.

## 3) Broader context
- [ ] Real bonk.io is rigid-body (Box2D-like), not a single-floor Processing sketch.
- [ ] The OSU `bonk_v6` draw() loop is still available in `tutorialPhysics.ts` for study (`npm run test:tutorial`), but it is **not** the game engine.
- [ ] `npm run test:movement` asserts spawn freeze, thrusters, **and falling off the arena**.

## Quiz yourself
1. Why did `state.x > 0 && state.x < width` prevent falling off Flat Arena?
2. With Matter gravity `y: 1.2` and `scale: 0.001`, roughly what weight does mass `1` feel? Why must `MOVE_FORCE` stay **below** that?
3. Why zeroing velocity after kinematic steps broke player–player bonks?

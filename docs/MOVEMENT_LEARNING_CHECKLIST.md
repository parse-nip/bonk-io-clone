# Movement Fix — Understanding Checklist

Use this to verify you understand the thruster-physics change.

## 1) The problem
- [ ] Classic mode used a **platformer jump** (`tryJump` only when grounded) and **no Down force**.
- [ ] Real bonk.io / the OSU tutorial use **continuous thruster forces** on Left/Right/Up/Down every frame.
- [ ] Air control was artificially reduced to 38%, so mid-air steering felt wrong.
- [ ] Why it mattered: without Up/Down thrusters you cannot start bouncing from rest the way bonk levels expect.

## 2) The solution
- [ ] `applyThrusterForce` sets `Fx`/`Fy` from input and calls `Matter.Body.applyForce` each update.
- [ ] Gravity stays in Matter (`engine.gravity`); net vertical accel is thrust + weight (tutorial's `Fnety = Fy - mass*g`).
- [ ] Same force in air and on ground (no `AIR_CONTROL` penalty).
- [ ] Heavy mode still lowers thruster magnitude and raises mass.
- [ ] Edge case: during Arrows aim, horizontal keys rotate aim; vertical thrusters still apply.

## 3) Broader impact
- [ ] Classic / Grapple / Football / Arrows (not aiming) all share the thruster path.
- [ ] Bots use Up/Down as thrusters, not rare jump taps.
- [ ] `npm run test:movement` asserts horizontal drive, lift, down-press, and air strafe.

## Quiz yourself (answers in the PR description)
1. Why is `Fnetx = Fx` an "extra step" in the tutorial if gravity is only vertical?
2. In Matter.js, which sign is "up" for `applyForce`? Why?
3. If thruster force ≤ weight force, can holding Up lift you off a flat floor? What else helps you bounce?

# Movement Fix — Understanding Checklist

Use this to verify you understand the thruster-physics change.

## 1) The problem
- [ ] Classic mode used a **platformer jump** (`tryJump` only when grounded) and **no Down force**.
- [ ] The OSU `bonk_v6` tutorial uses **exact kinematic integration** from `draw()`, not Matter.js `applyForce`.
- [ ] My first fix approximated forces in Matter — that was **not** what the assignment code does.

## 2) The solution (exact tutorial loop)
- [ ] Constants: `mass=3.0`, `dt=0.1`, `g=9.8`, thrust `±15`.
- [ ] Each frame: `vx += deltaVx`, `vy += deltaVy`, then `x += vx*dt`, `y += vy*dt`.
- [ ] Vertical: `Fy` from Up/Down → `Fnety = Fy - mass*g` → `deltaVy = (Fnety/mass)*dt`.
- [ ] Bounce: if `y - radius < 0` and `0 < x < width`, then `vy = -vy`.
- [ ] Horizontal: `Fx` from Left/Right → `Fnetx = Fx` → `deltaVx = (Fx/mass)*dt`.
- [ ] Implemented in `src/game/tutorialPhysics.ts`, wired in `src/game/engine.ts`.

## 3) Broader context
- [ ] Matter.js is collision-only for players; tutorial state drives position each frame.
- [ ] Heavy mode multiplies mass in the same formulas (slower accel, harder to push).
- [ ] `npm run test:movement` asserts horizontal drive, lift, down-press, and air strafe.

## Quiz yourself
1. Why is `Fnetx = Fx` an "extra step" when gravity is vertical only?
2. With `g=9.8`, `mass=3`, is `Fy=15` (Up) enough to hover? What does Down + Up bouncing do?
3. Why do we store `deltaVx`/`deltaVy` across frames instead of applying forces directly to velocity?

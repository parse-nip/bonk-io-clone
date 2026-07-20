# Learning Checklist — Bonk.io Clone Session

Use this to track understanding. Restate each item in your own words before marking it done.

## 1) The problem — why it exists, the branches

- [ ] What is bonk.io at a high level? (multiplayer physics knock-off arena)
- [ ] Why did the Flash → HTML5 rewrite happen, and why did “Bonk 2” become a faithful remake?
- [ ] What makes the core loop addictive? (mass/momentum + heavy tradeoff + edge death)
- [ ] What are the main product surfaces? (Guest/Login → Main Menu → Quick Play / Custom Game → Lobby → Match)
- [ ] Mode branches: Classic vs Arrows vs Death Arrows vs Grapple vs Football — what changes?
- [ ] Why is physics server-authoritative in the real game? (anti-cheat / fairness vs input lag)

**Quiz yourself:** If you removed heavy mode, what strategic depth disappears?

## 2) The solution — how we cloned it, decisions, edge cases

- [ ] Why Matter.js instead of shipping Box2D WASM?
- [ ] How does heavy mode work in our engine? (mass ↑, accel ↓)
- [ ] How do we detect elimination? (bounds / death fixtures)
- [ ] How do rounds and match wins work?
- [ ] How do bots approximate other players for Quick Play?
- [ ] Edge cases: mid-air heavy, glancing collisions, rotating platforms, aiming while moving in Arrows
- [ ] Why the UI uses brown buttons + charcoal field instead of a modern dashboard look

**Quiz yourself:** When should you activate heavy relative to contact, and why?

## 3) Broader context — why it matters, what changes impact

- [ ] How map geometry changes tactics (square vs circle vs rotating beam)
- [ ] How a map editor + skin editor turn a simple mechanic into a platform
- [ ] What would need to change to go from local/bots → real multiplayer rooms?
- [ ] What breaks if friction/restitution/mass ratios are wrong?

## 4) Map Editor — problem, solution, impact

- [ ] Why did bonk.io need a host-side map editor? (UGC → retention / custom rooms)
- [ ] What are the three original editor panels, and what job does each do?
- [ ] What’s the difference between Stationary, Free Moving, and Rotating platforms in *our* engine?
- [ ] Why do Death + No Physics interact the way they do? (death ignored when noPhysics)
- [ ] How do custom maps survive a refresh? (`localStorage` → `registerCustomMaps` → `MAPS`/`getMap`)
- [ ] What did we intentionally *not* clone yet (joints / collide groups), and why?

**Quiz yourself:** If you duplicate a platform with “Dup Invert X”, what coordinate changes, and why is that useful for symmetric arenas?

## Open quizzes (answer before looking at code)

1. Input bitfield: which bit is heavy? Special?
2. What does `ppm` control in map data?
3. In Grapple, what knocks you off your rope?
4. Name three host-only Custom Game powers.
5. In the editor Elements panel, what do + / 🗑 / ⧉ / ▲ / ▼ do?
6. Which move type creates a Matter constraint pivot in `BonkEngine.buildMap`?
7. Where is the editor draft autosaved so leaving the screen doesn’t wipe work?

---

**Session rule:** Don’t skip ahead — restate Stage 1 before Stage 2, Stage 2 before Stage 3.
When you reply, start by restating your current understanding; we’ll fill gaps and quiz from easy → hard.

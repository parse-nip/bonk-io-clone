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

- [ ] Why Planck.js (Box2D) instead of Matter.js for a bonk clone?
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

### 4b) Editor bugfix (this session) — restate before marking done

- [ ] **Problem:** Leaving the Map Editor and coming back spawned a flood of objects. Why? (`mountEditor` returned a cleanup fn, but `makeEditor` never called it → stacked `window` keydown listeners; plain `D` duplicated on every stacked handler + key-repeat)
- [ ] **Why that felt like “can’t delete”:** each Delete only removed one object from the *live* doc, while duplicates had already multiplied; list ✕ / props Delete were missing
- [ ] **Pivot problem:** rotate mode drew a marker at the body center only — no `pivotX`/`pivotY`, so you couldn’t offset the hinge like real bonk
- [ ] **Solution branch A (lifecycle):** `editorDispose` on every `render()` + dispose return from `mountEditor`
- [ ] **Solution branch B (UX):** per-row ✕, Delete in props, labeled Delete button, duplicate moved to **Ctrl+D**
- [ ] **Solution branch C (pivots):** local `pivotX`/`pivotY`, drag yellow crosshair, engine constraint uses offset `pointA`/`pointB`
- [ ] **Impact:** drafts stop self-corrupting across visits; rotating maps can hinge off-center; deleting is one-click from the list

### 4c) Fullscreen + offset-pivot render bug — restate before marking done

- [ ] **Problem A (tiny UI):** `.stage` was capped at `780×520` with an aspect-ratio lock, so the whole site lived in a small centered window
- [ ] **Why:** early “fixed game viewport” parity with classic bonk’s playfield size was applied to the *chrome*, not just the logical world
- [ ] **Solution A:** stage fills `100vw×100vh`; game renderer uses **uniform** scale + field-colored letterbox (not X/Y stretch — stretch turns discs into ellipses)
- [ ] **Problem B (offset pivot “broken”):** physics hinged correctly, but `drawBody` translated/rotated *and* fed already-rotated world `vertices` → **double angle**. Center pivots looked “mostly ok” (just 2× tip); offset pivots looked completely wrong because the body origin orbits the hinge while the mesh spun 2×
- [ ] **Solution B:** draw with `localVertices` + one body transform; RevoluteJoint uses explicit `localAnchorA/B`; editor angle edits keep world pivot fixed
- [ ] **Impact:** fullscreen usable UI; rotating maps with off-center hinges look like they play

### 4d) Editor blur after fullscreen — restate before marking done

- [ ] **Problem:** Map editor preview looked soft/blurry after the stage went fullscreen
- [ ] **Why:** `#ed-canvas` kept a fixed bitmap of `420×280` while CSS stretched it to the large preview panel — classic CSS-upscale blur. Pan/hit also mixed CSS pointer deltas with that tiny bitmap space
- [ ] **Solution:** resize the backing store to `cssSize × devicePixelRatio` (same pattern as `GameRenderer`), draw in CSS pixels via `setTransform(dpr)`, `ResizeObserver` + window resize; hit slop scales with zoom so handles stay grabable
- [ ] **Impact:** sharp editor at any window size; pan/zoom/click stay aligned; playfield stays circular under fullscreen letterbox

**Quiz yourself:** If you duplicate a platform with “Dup Invert X”, what coordinate changes, and why is that useful for symmetric arenas?

**Quiz (bugfix):** Why did cleaning up window listeners stop object spam even though the canvas DOM was already destroyed on leave?

**Quiz (scale):** Why does setting only CSS `width/height` on a canvas (without changing `canvas.width`/`height`) make drawings blurry when the panel gets larger?

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

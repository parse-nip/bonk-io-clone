/**
 * Verifies tutorialDrawStep matches bonk_v6 draw() numerics for one frame.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require("esbuild");

const out = path.join(root, "../.tmp-tutorial-physics.mjs");
esbuild.buildSync({
  entryPoints: [path.join(root, "../src/game/tutorialPhysics.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
});

const {
  TUTORIAL_DT,
  TUTORIAL_G,
  TUTORIAL_MASS,
  TUTORIAL_THRUST,
  createTutorialState,
  tutorialDrawStep,
} = await import(out);

const state = createTutorialState(375, 250, 10, 0);
tutorialDrawStep(
  state,
  { left: false, right: true, up: false, down: false },
  TUTORIAL_MASS,
  25,
  750,
);

const expectedDeltaVx = (TUTORIAL_THRUST / TUTORIAL_MASS) * TUTORIAL_DT;
const ok =
  Math.abs(state.vx - 10) < 1e-9 &&
  Math.abs(state.x - 376) < 1e-9 &&
  state.deltaVx === expectedDeltaVx &&
  state.deltaVy === -TUTORIAL_G * TUTORIAL_DT;

console.log(JSON.stringify({ ok, state, expectedDeltaVx }));
if (!ok) process.exit(1);

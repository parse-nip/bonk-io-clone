/**
 * Headless movement regression for thruster-based bonk physics:
 * spawn freeze, horizontal thrusters, no sustained flight, up slows fall,
 * down presses faster, air strafe, fall-off.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Matter from "matter-js";

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require("esbuild");

const out = path.join(root, "../.tmp-engine.mjs");
esbuild.buildSync({
  entryPoints: [path.join(root, "../src/game/engine.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
});

const { BonkEngine, emptyInput } = await import(out);

function settle(eng, frames = 200) {
  for (let i = 0; i < frames; i++) {
    eng.setInput("p1", emptyInput());
    eng.update(1 / 60);
  }
}

function drive(eng, input, frames = 90) {
  for (let i = 0; i < frames; i++) {
    eng.setInput("p1", input);
    eng.update(1 / 60);
  }
}

function makeEngine(mapId = "flat") {
  const eng = new BonkEngine("classic", mapId, 3);
  eng.addPlayers([
    {
      id: "p1",
      name: "Human",
      guest: true,
      skin: { baseColor: "#e74c3c", eyes: true, mouth: true, accent: "#111" },
      wins: 0,
      team: 1,
      ready: true,
    },
  ]);
  eng.startRound();
  return eng;
}

// 1) Stay pinned during Get Ready on Orbit (previously fell to death).
const orbit = makeEngine("circles");
for (let i = 0; i < 120; i++) {
  orbit.setInput("p1", { ...emptyInput(), right: true });
  orbit.update(1 / 60);
}
const orbitAlive = orbit.players[0].alive;
const orbitPinned =
  Math.abs(orbit.players[0].body.position.x - 200) < 1 &&
  Math.abs(orbit.players[0].body.position.y - 200) < 1;

// 2) Horizontal thrusters after BONK on flat arena.
const flatRight = makeEngine("flat");
settle(flatRight);
const startX = flatRight.players[0].body.position.x;
drive(flatRight, { ...emptyInput(), right: true });
const dxRight = flatRight.players[0].body.position.x - startX;

const flatLeft = makeEngine("flat");
settle(flatLeft);
const startLeftX = flatLeft.players[0].body.position.x;
drive(flatLeft, { ...emptyInput(), left: true });
const dxLeft = flatLeft.players[0].body.position.x - startLeftX;

// 3) Holding Up from the floor must NOT allow sustained flight.
const noFly = makeEngine("flat");
settle(noFly);
const floorY = noFly.players[0].body.position.y;
let minY = floorY;
for (let i = 0; i < 120; i++) {
  noFly.setInput("p1", { ...emptyInput(), up: true });
  noFly.update(1 / 60);
  minY = Math.min(minY, noFly.players[0].body.position.y);
}
const liftPx = floorY - minY;
const cannotFly = liftPx < 40;

// 4) Up thruster slows a fall (still descending, but less than freefall).
function fallDistance(holdUp) {
  const eng = makeEngine("flat");
  settle(eng);
  const p = eng.players[0];
  Matter.Body.setPosition(p.body, { x: 390, y: 120 });
  Matter.Body.setVelocity(p.body, { x: 0, y: 0 });
  const y0 = p.body.position.y;
  for (let i = 0; i < 45; i++) {
    eng.setInput("p1", holdUp ? { ...emptyInput(), up: true } : emptyInput());
    eng.update(1 / 60);
  }
  return p.body.position.y - y0;
}
const dropFree = fallDistance(false);
const dropUp = fallDistance(true);
const upSlowsFall = dropUp > 10 && dropUp < dropFree - 5;

// 5) Down thruster increases downward speed while airborne.
const down = makeEngine("flat");
settle(down);
Matter.Body.setPosition(down.players[0].body, { x: 390, y: 140 });
Matter.Body.setVelocity(down.players[0].body, { x: 0, y: 0 });
const midY = down.players[0].body.position.y;
let maxY = midY;
for (let i = 0; i < 40; i++) {
  down.setInput("p1", { ...emptyInput(), down: true });
  down.update(1 / 60);
  maxY = Math.max(maxY, down.players[0].body.position.y);
}
const pressedDown = maxY - midY > 10;

// 6) Full air control: horizontal thrust while airborne.
const air = makeEngine("flat");
settle(air);
Matter.Body.setPosition(air.players[0].body, { x: 390, y: 140 });
Matter.Body.setVelocity(air.players[0].body, { x: 0, y: 0 });
const airX0 = air.players[0].body.position.x;
drive(air, { ...emptyInput(), left: true }, 60);
const airDx = air.players[0].body.position.x - airX0;

// 7) Fall off Flat Arena past the platform — no invisible full-width floor.
const fall = makeEngine("flat");
settle(fall);
const fallP = fall.players[0];
Matter.Body.setPosition(fallP.body, { x: 670, y: 300 });
Matter.Body.setVelocity(fallP.body, { x: 2, y: 0 });
let fellPastFloor = false;
let maxFallY = fallP.body.position.y;
for (let i = 0; i < 180; i++) {
  fall.setInput("p1", emptyInput());
  fall.update(1 / 60);
  maxFallY = Math.max(maxFallY, fallP.body.position.y);
  if (fallP.body.position.y > 400) fellPastFloor = true;
  if (!fallP.alive) break;
}
const fellOff = fellPastFloor && maxFallY > 400;

const result = {
  ok:
    orbitAlive &&
    orbitPinned &&
    dxRight > 40 &&
    dxLeft < -40 &&
    cannotFly &&
    upSlowsFall &&
    pressedDown &&
    airDx < -20 &&
    fellOff &&
    !flatRight.players[0].body.isStatic,
  orbitAlive,
  orbitPinned,
  dxRight: +dxRight.toFixed(1),
  dxLeft: +dxLeft.toFixed(1),
  liftPx: +liftPx.toFixed(1),
  cannotFly,
  dropFree: +dropFree.toFixed(1),
  dropUp: +dropUp.toFixed(1),
  upSlowsFall,
  downDropPx: +(maxY - midY).toFixed(1),
  pressedDown,
  airDx: +airDx.toFixed(1),
  fellOff,
  maxFallY: +maxFallY.toFixed(1),
  fallAlive: fallP.alive,
  playerStatic: flatRight.players[0].body.isStatic,
};

console.log(JSON.stringify(result));
if (!result.ok) process.exit(1);

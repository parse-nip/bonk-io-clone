/**
 * Headless movement regression for thruster-based bonk physics:
 * spawn freeze, horizontal/vertical thrusters, air control, fall-off.
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

// 3) Up thruster lifts off the floor.
const up = makeEngine("flat");
settle(up);
const floorY = up.players[0].body.position.y;
let minY = floorY;
for (let i = 0; i < 90; i++) {
  up.setInput("p1", { ...emptyInput(), up: true });
  up.update(1 / 60);
  minY = Math.min(minY, up.players[0].body.position.y);
}
const lifted = floorY - minY > 15;

// 4) Down thruster increases downward speed while airborne.
const down = makeEngine("flat");
settle(down);
for (let i = 0; i < 30; i++) {
  down.setInput("p1", { ...emptyInput(), up: true });
  down.update(1 / 60);
}
const midY = down.players[0].body.position.y;
let maxY = midY;
for (let i = 0; i < 40; i++) {
  down.setInput("p1", { ...emptyInput(), down: true });
  down.update(1 / 60);
  maxY = Math.max(maxY, down.players[0].body.position.y);
}
const pressedDown = maxY - midY > 10;

// 5) Full air control: horizontal thrust while airborne.
const air = makeEngine("flat");
settle(air);
for (let i = 0; i < 40; i++) {
  air.setInput("p1", { ...emptyInput(), up: true });
  air.update(1 / 60);
}
const airX0 = air.players[0].body.position.x;
drive(air, { ...emptyInput(), left: true }, 60);
const airDx = air.players[0].body.position.x - airX0;

// 6) Fall off Flat Arena past the platform — no invisible full-width floor.
const fall = makeEngine("flat");
settle(fall);
const fallP = fall.players[0];
// Place just past the right edge of the 520-wide platform centered at 390.
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

// 7) Player–player collision transfers momentum (rigid body, not kinematic).
function makeTwoPlayer() {
  const eng = new BonkEngine("classic", "flat", 3);
  eng.addPlayers([
    {
      id: "p1",
      name: "A",
      guest: true,
      skin: { baseColor: "#e74c3c", eyes: true, mouth: true, accent: "#111" },
      wins: 0,
      team: 1,
      ready: true,
    },
    {
      id: "p2",
      name: "B",
      guest: true,
      skin: { baseColor: "#3498db", eyes: true, mouth: true, accent: "#111" },
      wins: 0,
      team: 1,
      ready: true,
      isBot: true,
    },
  ]);
  eng.startRound();
  return eng;
}

const smash = makeTwoPlayer();
settle(smash);
const a = smash.players[0];
const b = smash.players[1];
Matter.Body.setPosition(a.body, { x: 300, y: 300 });
Matter.Body.setPosition(b.body, { x: 360, y: 300 });
Matter.Body.setVelocity(a.body, { x: 8, y: 0 });
Matter.Body.setVelocity(b.body, { x: 0, y: 0 });
const bX0 = b.body.position.x;
let bGotHit = false;
for (let i = 0; i < 45; i++) {
  smash.setInput("p1", emptyInput());
  smash.setInput("p2", emptyInput());
  smash.update(1 / 60);
  if (b.body.velocity.x > 1.5 || b.body.position.x - bX0 > 8) {
    bGotHit = true;
    break;
  }
}

// 8) Heavy doubles mass and weakens thruster response vs light.
const heavyCmp = makeEngine("flat");
settle(heavyCmp);
const lightX0 = heavyCmp.players[0].body.position.x;
drive(heavyCmp, { ...emptyInput(), right: true }, 60);
const lightDx = heavyCmp.players[0].body.position.x - lightX0;

const heavyEng = makeEngine("flat");
settle(heavyEng);
const heavyX0 = heavyEng.players[0].body.position.x;
drive(heavyEng, { ...emptyInput(), right: true, heavy: true }, 60);
const heavyDx = heavyEng.players[0].body.position.x - heavyX0;
const heavySlower = heavyDx < lightDx * 0.75;
const heavyMassOk = Math.abs(heavyEng.players[0].body.mass - 2) < 0.05;

const result = {
  ok:
    orbitAlive &&
    orbitPinned &&
    dxRight > 40 &&
    dxLeft < -40 &&
    lifted &&
    pressedDown &&
    airDx < -20 &&
    fellOff &&
    bGotHit &&
    heavySlower &&
    heavyMassOk &&
    !flatRight.players[0].body.isStatic,
  orbitAlive,
  orbitPinned,
  dxRight: +dxRight.toFixed(1),
  dxLeft: +dxLeft.toFixed(1),
  liftPx: +(floorY - minY).toFixed(1),
  lifted,
  downDropPx: +(maxY - midY).toFixed(1),
  pressedDown,
  airDx: +airDx.toFixed(1),
  fellOff,
  maxFallY: +maxFallY.toFixed(1),
  fallAlive: fallP.alive,
  bGotHit,
  lightDx: +lightDx.toFixed(1),
  heavyDx: +heavyDx.toFixed(1),
  heavySlower,
  heavyMass: +heavyEng.players[0].body.mass.toFixed(2),
  playerStatic: flatRight.players[0].body.isStatic,
};

console.log(JSON.stringify(result));
if (!result.ok) process.exit(1);

/**
 * Headless movement regression for tutorial-tuned Box2D thrusters.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const { BonkEngine, emptyInput, PLAYER_RADIUS, PLAYER_MASS } = await import(out);

/** Flat Arena platform top (center 360, half-height 18). */
const FLAT_FLOOR_TOP = 360 - 18;
const FLAT_REST_Y = FLAT_FLOOR_TOP - PLAYER_RADIUS;

function settle(eng, frames = 240) {
  for (let i = 0; i < frames; i++) {
    eng.setInput("p1", emptyInput());
    if (eng.players[1]) eng.setInput("p2", emptyInput());
    eng.update(1 / 60);
  }
}

function plantOnFlat(eng, x = 390) {
  const p = eng.players[0];
  p.body.setPosition(x, FLAT_REST_Y);
  p.body.setVelocity(0, 0);
  p.body.setAngularVelocity(0);
  for (let i = 0; i < 20; i++) {
    eng.setInput("p1", emptyInput());
    eng.update(1 / 60);
  }
  p.body.setPosition(x, FLAT_REST_Y);
  p.body.setVelocity(0, 0);
  p.body.setAngularVelocity(0);
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

// 1) Stay pinned during Get Ready on Orbit.
const orbit = makeEngine("circles");
for (let i = 0; i < 120; i++) {
  orbit.setInput("p1", { ...emptyInput(), right: true });
  orbit.update(1 / 60);
}
const orbitAlive = orbit.players[0].alive;
const orbitPinned =
  Math.abs(orbit.players[0].body.position.x - 200) < 1 &&
  Math.abs(orbit.players[0].body.position.y - 262) < 1;

// 2) Horizontal thrusters — tutorial wall-clock pace (~200px / 1.5s).
const flatRight = makeEngine("flat");
settle(flatRight);
plantOnFlat(flatRight, 390);
const startX = flatRight.players[0].body.position.x;
drive(flatRight, { ...emptyInput(), right: true });
const dxRight = flatRight.players[0].body.position.x - startX;

const flatLeft = makeEngine("flat");
settle(flatLeft);
plantOnFlat(flatLeft, 390);
const startLeftX = flatLeft.players[0].body.position.x;
drive(flatLeft, { ...emptyInput(), left: true });
const dxLeft = flatLeft.players[0].body.position.x - startLeftX;

// 3) Up slows a fall but does not overcome gravity.
const fallSlow = makeEngine("flat");
settle(fallSlow);
fallSlow.players[0].body.setPosition(390, 120);
fallSlow.players[0].body.setVelocity(0, 0);
for (let i = 0; i < 30; i++) {
  fallSlow.setInput("p1", { ...emptyInput(), up: true });
  fallSlow.update(1 / 60);
}
const yWithUp = fallSlow.players[0].body.position.y;

const fallFast = makeEngine("flat");
settle(fallFast);
fallFast.players[0].body.setPosition(390, 120);
fallFast.players[0].body.setVelocity(0, 0);
for (let i = 0; i < 30; i++) {
  fallFast.setInput("p1", emptyInput());
  fallFast.update(1 / 60);
}
const yNoUp = fallFast.players[0].body.position.y;
const upSlowsFall = yWithUp < yNoUp - 8;

// Jump / land-hop while holding Up (tutorial floor bounce feel).
const bounce = makeEngine("flat");
settle(bounce);
plantOnFlat(bounce, 390);
const jumpFloor = bounce.players[0].body.position.y;
// Press Up on ground → hop.
bounce.setInput("p1", { ...emptyInput(), up: true });
bounce.update(1 / 60);
let jumpPeak = jumpFloor;
let leftGround = false;
for (let i = 0; i < 90; i++) {
  bounce.setInput("p1", { ...emptyInput(), up: true });
  bounce.update(1 / 60);
  const y = bounce.players[0].body.position.y;
  jumpPeak = Math.min(jumpPeak, y);
  if (y < jumpFloor - 20) leftGround = true;
}
// Crisp hop (~45–70px): readable but not floaty hang-time.
const bounced = leftGround && jumpFloor - jumpPeak > 40;

// No sustained flight.
const noFly = makeEngine("flat");
settle(noFly);
noFly.players[0].body.setPosition(390, 160);
noFly.players[0].body.setVelocity(0, -20);
let peakY = noFly.players[0].body.position.y;
for (let i = 0; i < 60; i++) {
  noFly.setInput("p1", { ...emptyInput(), up: true });
  noFly.update(1 / 60);
  peakY = Math.min(peakY, noFly.players[0].body.position.y);
}
let endY = peakY;
for (let i = 0; i < 120; i++) {
  noFly.setInput("p1", { ...emptyInput(), up: true });
  noFly.update(1 / 60);
  endY = noFly.players[0].body.position.y;
}
const cannotFly = endY > peakY + 40 && endY > 220;

// Down thruster.
const down = makeEngine("flat");
settle(down);
down.players[0].body.setPosition(390, 180);
down.players[0].body.setVelocity(0, -5);
for (let i = 0; i < 10; i++) {
  down.setInput("p1", emptyInput());
  down.update(1 / 60);
}
const midY = down.players[0].body.position.y;
let maxY = midY;
for (let i = 0; i < 25; i++) {
  down.setInput("p1", { ...emptyInput(), down: true });
  down.update(1 / 60);
  maxY = Math.max(maxY, down.players[0].body.position.y);
}
const pressedDown = maxY - midY > 15;

// Air control.
const air = makeEngine("flat");
settle(air);
air.players[0].body.setPosition(390, 160);
air.players[0].body.setVelocity(0, -5);
for (let i = 0; i < 8; i++) {
  air.setInput("p1", emptyInput());
  air.update(1 / 60);
}
const airX0 = air.players[0].body.position.x;
drive(air, { ...emptyInput(), left: true }, 60);
const airDx = air.players[0].body.position.x - airX0;

// Fall off.
const fall = makeEngine("flat");
settle(fall);
const fallP = fall.players[0];
fallP.body.setPosition(700, 200);
fallP.body.setVelocity(5, 0);
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

// Collision momentum.
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
a.body.setPosition(300, FLAT_REST_Y);
b.body.setPosition(360, FLAT_REST_Y);
a.body.setVelocity(40, 0);
b.body.setVelocity(0, 0);
const bX0 = b.body.position.x;
let bGotHit = false;
for (let i = 0; i < 45; i++) {
  smash.setInput("p1", emptyInput());
  smash.setInput("p2", emptyInput());
  smash.update(1 / 60);
  if (b.body.velocity.x > 2 || b.body.position.x - bX0 > 8) {
    bGotHit = true;
    break;
  }
}

// Heavy slower + ~2× mass.
const heavyCmp = makeEngine("flat");
settle(heavyCmp);
plantOnFlat(heavyCmp, 390);
const lightX0 = heavyCmp.players[0].body.position.x;
drive(heavyCmp, { ...emptyInput(), right: true }, 60);
const lightDx = heavyCmp.players[0].body.position.x - lightX0;

const heavyEng = makeEngine("flat");
settle(heavyEng);
plantOnFlat(heavyEng, 390);
const heavyX0 = heavyEng.players[0].body.position.x;
drive(heavyEng, { ...emptyInput(), right: true, heavy: true }, 60);
const heavyDx = heavyEng.players[0].body.position.x - heavyX0;
const heavySlower = heavyDx < lightDx * 0.75;
const heavyMassOk =
  Math.abs(heavyEng.players[0].body.mass - PLAYER_MASS * 2) < 0.15;
const lightMassOk =
  Math.abs(flatRight.players[0].body.mass - PLAYER_MASS) < 0.15;

const result = {
  ok:
    orbitAlive &&
    orbitPinned &&
    dxRight > 80 &&
    dxLeft < -80 &&
    upSlowsFall &&
    bounced &&
    cannotFly &&
    pressedDown &&
    airDx < -30 &&
    fellOff &&
    bGotHit &&
    heavySlower &&
    heavyMassOk &&
    lightMassOk &&
    !flatRight.players[0].body.isStatic,
  orbitAlive,
  orbitPinned,
  dxRight: +dxRight.toFixed(1),
  dxLeft: +dxLeft.toFixed(1),
  upSlowsFall,
  yWithUp: +yWithUp.toFixed(1),
  yNoUp: +yNoUp.toFixed(1),
  bounced,
  bouncePeakPx: +(jumpFloor - jumpPeak).toFixed(1),
  cannotFly,
  peakY: +peakY.toFixed(1),
  noFlyEndY: +endY.toFixed(1),
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
  heavyMass: +heavyEng.players[0].body.mass.toFixed(3),
  lightMass: +flatRight.players[0].body.mass.toFixed(3),
  playerStatic: flatRight.players[0].body.isStatic,
  playerRadius: PLAYER_RADIUS,
};

console.log(JSON.stringify(result));
if (!result.ok) process.exit(1);
